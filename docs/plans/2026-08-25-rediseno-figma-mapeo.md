# Mapeo rediseño Figma ↔ web — manifiesto de implementación

**Fuente de verdad**: archivo Figma cloud "Pantallas- We Otzi" — fileKey `UmVbDewiAHkfLedTR5uyFj`.

- Página **Flujo artistas**: node `0:1` (80 frames de nivel superior)
- Página **Flujo clientes**: node `205:302` (40 frames de nivel superior)

Acceso vía MCP oficial de Figma (remoto, funciona con el fileKey; no requiere Figma Desktop
ni el Dev Mode MCP). La primera ola del rediseño (ago 2026) se implementó desde un snapshot
`.fig` local con `scripts/figma/`; este manifiesto gobierna la **segunda ola contra el archivo
cloud vivo**, que tiene frames nuevos (prefijos de node-id ≥ `344:` aprox.).

## Pipeline por pantalla (cómo se implementa cada fila)

1. Leer **todos** los frames del grupo: `get_screenshot` (referencia visual) y
   `get_design_context` (specs) por node-id.
2. Implementar/ajustar la página destino usando **solo** el DS
   (`public/shared/css/ds/` — reglas duras en su README; iconos Feather vía `wo-icons.js`).
3. Verificar en preview (`http://localhost:4545/<ruta>`) lado a lado contra la captura de Figma.
4. `node --test "tests/*.test.js"` en verde → commit por pantalla (`feat(rediseno):` /
   `fix(rediseno):`).
5. Actualizar el **Estado** de la fila en este archivo (→ `hecha` + fecha).

## Reglas de decisión (cómo se leyó el canvas)

- **Mismo nombre = misma pantalla**; los frames son estados/pasos, en orden de `x` creciente
  (filas por `y`). El orden listado abajo ya es el orden del flujo.
- **Frames superpuestos en la misma posición** = revisión nueva sobre vieja → gana el node-id
  **mayor**, salvo veto explícito. Casos detectados: `413:728` → gana `414:1012` (Crear cuenta
  cliente); `111:7059` → gana `132:15483` (Postulaciones Job board).
- `obviar` = no es pantalla: diagramas, fragmentos y componentes sueltos. Se pueden usar como
  spec de detalle de un componente, pero no generan página.
- **Nada se borra de la web sin reemplazo**: páginas sin frame rediseñado quedan como están
  (studio/*, soporte, backoffice, explore 2D, pre-cotizador, tutorial, archive).

## Estados

- `hecha-v1` — implementada en la primera ola desde el snapshot `.fig`. Acción: **re-auditar**
  fidelidad contra el cloud actual (puede haber cambiado) y cubrir estados nuevos.
- `pendiente` — no implementada aún; el diseño está listo.
- `sin-backend` — diseño listo pero la feature no tiene modelo de datos; no implementar sin
  decisión de producto.
- `obviar` — no es pantalla del rediseño.
- `verificar` — falta confirmar a qué flujo pertenece un frame; lo resuelve discovery sin bloquear.

---

## Flujo artistas (page `0:1`)

| Grupo (pantalla) | Node-ids (en orden de flujo) | Destino web | Estado | Notas |
| --- | --- | --- | --- | --- |
| "flujo" (diagrama) | 167:24554 | — | obviar | Diagrama general del flujo (11.687px de ancho), no es pantalla. |
| Landing clientes | 2:1744 | `/inicio` | hecha-v1 | Duplicada; la canónica es 205:303 (página clientes). |
| Landing tatuador | 5:2809 | `/landing-tatuador` | hecha-v1 | |
| Crear cuenta (beta cerrada) | 22:1106 | `/registerclosedbeta` | hecha-v1 | Split: póster oscuro "TU PRÓXIMO PROYECTO ESTA ACÁ" + form "Crea tu cuenta". Confirmado por captura ("ACCESO ANTICIPADO · BETA CERRADA"). |
| Ingreso artista | 24:1261 | `/artist/login` | hecha-v1 | Split: póster "ACCEDÉ A TU PANEL" + form. |
| Registro artista (wizard) | 72:12357, 72:12438, 72:12519 (+variante 105:4935 debajo), 72:12639, 72:12764 (+variante 422:2873 debajo), 72:12865, 72:12993, 72:13161, 114:9006 | `/register-artist` | hecha (re-auditada 26 ago) | Corregida contra las variantes nuevas: modalidad "Ambos", typeahead de estudios, address picker condicional. |
| Loaders post-auth | 239:2514, 243:2917 (duplicado exacto), 415:1733 (variante cliente) | componente compartido `public/shared/js/wo-postauth-loader.js` | hecha | Resuelto en discovery: se llamaban "Registro"/"Container" pero son pantallas de carga ("Organizando tu agenda…" artista / "Explorando artistas…" cliente). No son páginas. |
| Recuperar contraseña | 243:2530, 243:2600, 243:2669, 243:2778 | `/recover` (única, cliente+artista) | hecha (26 ago) | 4 pasos: pedir acceso → verificar código → nueva contraseña → éxito. |
| INICIO (selección de rol) | 238:2335 (= 205:666 en pág. clientes) | `/bienvenida` (post-registro) | hecha (26 ago) | "¿Cómo querés usar We Ötzi?" — cards Cliente/Artista. |
| Dashboard artista | 24:1424 | `/artist/dashboard` | hecha-v1 | |
| Notificaciones (panel) | 167:24120, 167:23251 | panel en `/artist/dashboard` | hecha-v1 | Implementado en commit `0c67a5c`; re-auditar ambos estados. |
| Centro de la cuenta | 156:10014, 156:10807, 156:11993, 156:12247, 158:13029, 158:13480, 161:14150, 161:14507, 162:15088 | `/artist/account` (nueva) | hecha (26 ago) | Sidebar de 9 secciones: Mi Perfil, Portafolio, Cobros y facturación, Disponibilidad, Notificaciones, Seguridad y Privacidad, Integraciones, Verificación, Configuración. Hoy repartido entre dashboard y `profile/details`. |
| Perfil público artista | 237:2096, 344:1184 | `/artist/profile` | hecha (re-auditada 26 ago) | Auditada y corregida contra `344:1184` (CTA dual, manifiesto de bio, detalles geométricos). |
| Cotizaciones | 33:5758, 99:908 | `/my-quotations` | hecha-v1 | |
| Cotización — detalle | 62:11137 | drawer/detalle en `/my-quotations` | hecha-v1 | |
| Job board artista | 28:1856, 104:2707, 105:4079 | `/job-board` | hecha-v1 | |
| Postulaciones del artista | 105:4480, 132:15483 (reemplaza 111:7059), 133:16259 (detalle JB), 111:7694 (Spots), 132:15871 (detalle Spot) | `/artist/applications` (nueva, dedicada) | hecha (26 ago) | Job board y Spots separados, cada uno con su detalle. |
| Spots | 28:3877, 109:5448, 112:8505 | `/studio-spots` | hecha-v1 | |
| Invitaciones | 42:6903, 120:9027 | `/artist/invitations` | hecha-v1 | |
| Aside (drawer invitaciones) | 120:10117, 120:10391, 120:10676 | — | obviar | Fragmentos de 380px; solo spec del drawer. |
| Calendario | 52:8311, 52:9043, 52:9286, 153:4421, 153:5224, 153:5493, 153:6155, 153:6807, 153:7430, 153:8075, 153:8735, 153:9373 | `/calendar` | hecha-v1 | 12 estados (vistas + modales); re-auditar cubriendo todos. |
| Estadísticas | 122:12196 | `/my-quotations/statistics` | hecha-v1 | |
| Travel | 68:11882, 419:2487, 131:14426, 132:14729, 173:24897, 173:25982, 173:26741, 173:27503, 173:28256 | `/artist/travel` (nueva) | hecha (26 ago) | Backend aplicado y cableado; incluye página pública `/travel/share?slug=…`. |
| INBOX | 144:1250 | `/artist/inbox` (nueva) | hecha (26 ago) | Sobre `chat_threads` + hilo fijo de Soporte; filtros sin backend quedan "próximamente". |

## Flujo clientes (page `205:302`)

| Grupo (pantalla) | Node-ids (en orden de flujo) | Destino web | Estado | Notas |
| --- | --- | --- | --- | --- |
| Landing clientes | 205:303 | `/inicio` | hecha-v1 | Canónica. |
| Crear cuenta cliente | 205:632, 391:539, 414:1012 (reemplaza 413:728), 414:1141, 415:1476, 415:1677 (éxito "Tu perfil está listo") | `/client/register` | hecha (re-auditada 26 ago) | Reconstruida como wizard fullscreen de 4 pasos + éxito "Tu perfil está listo" según los frames nuevos; datos nuevos en `client_profiles` y `user_preferences`. |
| Ingreso cliente | 205:649 | `/client/login` | hecha-v1 | |
| INICIO (selección de rol) | 205:666 | `/bienvenida` (= 238:2335) | hecha (26 ago) | Mismo frame que en pág. artistas. |
| Dashboard cliente | 251:4793 | `/client/dashboard` | hecha-v1 | |
| Marketplace | 277:6587 | `/marketplace` | hecha (re-auditada 26 ago) | Corregida contra el canon 286:11953: destacados, favoritos (`client_favorites`), "Artistas para vos", drawer de filtros. |
| Job board cliente | 295:14727, 286:8577, 286:13942, 286:14417, 299:16500, 307:18253, 307:18543 | `/job-board/request` (rediseño) + `/client/requests` (nueva, dedicada) | hecha (26 ago) | Wizard con paso de inspiración IA + vista dedicada con todos los estados y negociación. |
| Postulaciones — detalle | 307:17015 | integrada en `/client/requests` | hecha (26 ago) | |
| image-slot | 295:15537 | — | obviar | Slot de imagen suelto. |
| Formulario cotización | 286:9421 (+419:2321 debajo), 318:19519, 318:20160, 318:20430, 318:20842, 318:21077, 318:21865 | `/quotation` | hecha (re-auditada 26 ago) | Corregida contra la serie `318:*`/`419:*`: toggle de modo de idea, silueta corporal (aside 318:19919), nivel de personalización, notas por referencia — persisten en `quotation_intake_extras`. |
| Container (aside cotización) | 318:19919 | — | obviar | Fragmento de 376px. |
| Tarjeta estudios | 415:2108 | componente card de estudio (marketplace) | obviar | Spec de componente, no pantalla. |
| Tattoglobe | 286:10265 | `/explore/globe` | pendiente | Rediseño del globo 3D; relacionado con `docs/plans/2026-06-11-globo-3d-redesign.md`. |
| Chats | 286:11109, 333:1540 | `/client/chats` (nueva, dedicada) | hecha (26 ago) | Sobre `chat_messages` + vista `chat_threads`, con realtime arreglado. |
| Centro de cuenta cliente | — sin frame propio | `/client/profile` (rediseño derivado del patrón centro de cuenta) | hecha (26 ago) | Resuelto en discovery: 286:11953 es en realidad el explore "Descubrí artistas" (pasa a referencia de re-auditoría de `/marketplace`–`/explore`) y 307:17498 es el perfil público de artista (referencia de `/artist/profile`). |
| VerticalBorder | 332:1104 | — | obviar | Fragmento. |
| Perfil público (vista cliente) | 344:302, 354:539 | `/artist/profile` | hecha-v1 | Misma pantalla que en flujo artistas; auditar una sola vez. |

---

## Decisiones de Isaí (25 ago 2026)

1. **INICIO / selección de rol**: sí — pantalla post-registro en `/bienvenida`.
2. **Centro de la cuenta artista**: sí — ruta nueva `/artist/account` con sidebar de 9 secciones.
3. **Travel e INBOX**: **hacer backend y cablearlo** — modelo de datos nuevo (migraciones
   aditivas + repos PostgREST + UI) para `/artist/travel` y `/artist/inbox`.
4. **Duplicados superpuestos**: gana el node-id mayor (`414:1012`, `132:15483`).
5. **Postulaciones/solicitudes**: vistas dedicadas — `/artist/applications` y `/client/requests`.
6. **Recuperar contraseña**: ruta única compartida `/recover`.

## Criterios de implementación (fijados en la sesión autónoma del 25 ago)

- **Copy**: rioplatense con voseo, sin signos de exclamación, sentence case; traducir el
  inglés heredado del kit (FEATURED, LOG OUT, Yesterday…); typos corregidos
  ("restablecer", "mismo lugar", "PRÓXIMAS"). Datos dummy inconsistentes de los mocks
  se unifican. Números europeos (`4.820`).
- **Botones**: azul `--direct` = CTA primario "de proceso"; amarillo accent máx. 1 por
  vista para la acción estrella; CTA de `/recover` y ENVIAR del chat en ink.
- **Topbar artista canónica**: COTIZACIONES · JOB BOARD · SPOTS · CALENDARIO ·
  ESTADÍSTICAS · TRAVEL · INBOX + tile Ö. Ítem activo = la sección real (los mocks
  que subrayan COTIZACIONES fuera de Cotizaciones son error de mock).
- **Avatares circulares** (regla DS); iconos Feather via `data-wo-icon`.
- **Job board**: fecha aproximada conserva las columnas legacy
  (`client_preferred_date`/`client_flexible_dates`); título de la publicación se deriva
  en render (descripción+estilo+zona), sin columna nueva; la reserva post-selección
  reutiliza `POST /api/job-board/accept-application` → flujo de Cotizaciones.
- **Omitidos v1** (sin backend real, se muestran deshabilitados "próximamente" o se
  omiten): push/SMS en notificaciones, 2FA, lista de sesiones remotas, selector de tema
  (regla DS 11: sin modo oscuro), métodos de pago (solo datos fiscales), clima en
  Travel, globo interactivo (SVG estático), adjuntos en chat.

## Backend segunda ola (aplicado el 25 ago 2026 al proyecto `flbgmlvfiejfttlawnfu`)

- `20260825100000_artist_travel.sql` — artist_trips + 4 satélites + bucket
  `artist-trip-docs` + RLS. **Aplicada.**
- `20260825110000_chat_threads_realtime.sql` — vista `chat_threads`
  (security_invoker) + **fix**: `chat_messages` y `job_board_applications` no estaban
  en la publicación `supabase_realtime` (las suscripciones existentes nunca
  disparaban). **Aplicada** (en dos partes).
- `20260825120000_account_center.sql` — `user_preferences` +
  `artist_billing_profiles`. **Aplicada** (en dos partes). El horario semanal de
  Disponibilidad vive en `app_settings.availability` (se decidió no alterar
  `artists_db`).
- `20260825130000_job_board_negotiation.sql` — `job_board_counter_offers` +
  `job_board_request_stats` + RPC `increment_job_request_views`. **Aplicada** (en dos
  partes).
- `20260825140000_artist_verification_documents.sql` — **PENDIENTE DE APLICAR**: el
  permission gate de la sesión autónoma bloqueó crear infraestructura de recolección
  de documentos de identidad; la aplica Isaí manualmente. La UI degrada
  (`WeotziData.VerificationDocs.isAvailable()`).
- `20260825150000_applied_visibility_policies.sql` — el artista sigue viendo la
  solicitud/spot al que postuló aunque ya no esté abierto. **Aplicada** (en dos partes).
- Capa de datos frontend: `travel-repo.js`, `account-repo.js`, `jobboard-repo.js`
  (nuevos), `Chat.listThreadsForArtist/ForClient` (quotations-repo),
  `StudioSpots.listApplicationsByArtist/withdrawApplication` (studios-repo),
  `wo-postauth-loader.js` (loader compartido).

## Convención opcional en Figma (para futuras iteraciones)

No hace falta que renombres nada de lo existente — este manifiesto ya lo resuelve. Para lo nuevo:

- Prefijo `x ` en el nombre de un frame = "obviar" (lo filtro automáticamente al re-sincronizar).
- Mantené "mismo nombre = misma pantalla" para estados/pasos (ya lo cumplís).
- Si un grupo cambia o se agrega, avisá con el nombre de la pantalla y alcanza; el node-id y la
  ruta los resuelvo acá.

## Orden de trabajo

1. **Discovery** (specs exhaustivas por grupo pendiente + mapa de código) — 25 ago.
2. **Pendientes con backend existente**: `/client/requests` + job board cliente,
   `/artist/applications`, `/client/chats`, `/client/profile` (centro de cuenta), `/recover`.
3. **Pantallas nuevas**: `/bienvenida`, `/artist/account`.
4. **Backend nuevo + UI**: `/artist/travel`, `/artist/inbox` (migraciones aditivas + repos + páginas).
5. **Re-auditoría de las `hecha-v1`** contra el cloud (prioridad: frames nuevos — Crear cuenta
   cliente, Formulario cotización, Perfil público, Registro artista).
6. **Tattoglobe** al final (plan propio).
