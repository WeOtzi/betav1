# Brief común · Figma final del flujo de artista (oct 2026)

Leé este archivo completo antes de empezar. Tu prompt agrega el área, los frames y los archivos que te pertenecen.

## Objetivo

El Figma **"We Otzi Pantallas final"** (fileKey `w3JA83CcP5ISKjyOu87mx1`, página `0:1` "Flujo artistas") es la versión **final** de todo el flujo del artista. Cada frame es un mockup de una pantalla o de un estado de pantalla (modal, drawer, variante). Para tu área tenés que:

1. **Copiar exactamente el diseño** en la pantalla existente que corresponde: layout, orden de bloques, espaciados, tipografía, colores, iconos, bordes, estados y copy.
2. **Crear y dejar funcionando** las pantallas o estados que no existen (no maquetas estáticas: todos los botones, formularios, filtros, tabs, modales y links tienen que hacer algo real).
3. **Detectar** lo que existe en la web de tu área y **no** aparece en el Figma (secciones, tabs, botones, widgets o rutas enteras). Las secciones dentro de tus páginas las quitás vos. Las rutas o páginas enteras **no las borres**: proponelas en el reporte (las elimina el orquestador de forma centralizada y reversible).
4. Dejar un **reporte** de tu área (formato abajo).

El repo es `C:\dev\weotzi-unified` (rama `feature/figma-final-artista`, ya creada). Leé `CLAUDE.md`, `public/shared/css/ds/README.md` (reglas del DS) y `docs/GUIA_CAPA_DATOS.md` (capa de datos) antes de editar.

## Acceso a Figma

- Servidor MCP oficial (cloud): herramientas `mcp__d2f43ce5-a984-40c9-983c-55fa89e85d28__*`. Cargalas con ToolSearch:
  `select:mcp__d2f43ce5-a984-40c9-983c-55fa89e85d28__get_design_context,mcp__d2f43ce5-a984-40c9-983c-55fa89e85d28__get_screenshot,mcp__d2f43ce5-a984-40c9-983c-55fa89e85d28__get_metadata,mcp__d2f43ce5-a984-40c9-983c-55fa89e85d28__download_assets`
- **Antes del primer `get_design_context` cargá el skill `figma:figma-design-to-code`** (herramienta Skill) y seguilo; pasá `skillNames: "figma-design-to-code"`.
- Usá siempre `fileKey: "w3JA83CcP5ISKjyOu87mx1"` y `sessionId: "e983411d-4e2a-4a0c-8c23-8f54dbb9f44d"`.
- `get_screenshot` devuelve una URL temporal: bajala con `curl -s -f -L -o output/figma-final-artista/frames/<nodeid-con-guion>_<slug>.png "<url>"` (usá `maxDimension` 1440 o más si necesitás detalle). Si el archivo ya existe en esa carpeta, reutilizalo.
- `get_design_context` es la fuente de specs (medidas, colores, tipografías, textos). Si viene "sparse", pedí los hijos visibles.
- Si el MCP responde con rate limit, esperá y reintentá; no abandones el frame.
- Assets (íconos, imágenes): íconos con Feather vía `data-wo-icon` (ya disponible). Los slots de imagen del mockup ("Ilustración editorial…", "browse files", placeholders grises) son contenido dinámico o assets que faltan: usá datos reales o un placeholder del DS y anotalo en el reporte como "asset faltante".

## Stack y convenciones (no negociables)

- Vanilla HTML/CSS/JS, sin framework ni build. Cada página vive en `public/<ruta>/index.html`; CSS y JS compartidos en `public/shared/`.
- Design system en `public/shared/css/ds/` (tokens, components, molecules, organisms, site-components). **No edites los archivos del DS**: usá sus clases y tokens; lo específico va en el CSS de tu página. Si el Figma usa un valor que no existe como token, usá el token más cercano y anotalo.
- Datos **siempre** vía la capa PostgREST: `window.WeotziData.*` (repos en `public/shared/js/data/`). Prohibido `fetch('/rest/v1/...')` inline o `_supabase.from(...)` suelto.
- Topbar del artista = custom element `<weotzi-product-nav>` (en `public/shared/js/ds/site-components.js`). **Solo el agente del área Dashboard lo edita.** Si tu frame muestra diferencias en la topbar o el footer, anotalas en el reporte y no las toques.
- Copy del producto en español rioplatense. **Copiá el texto del Figma literal**, salvo errores ortográficos evidentes (acentos mal puestos, "tú" por "tu", typos), que corregís y listás en el reporte. Los datos de ejemplo del mockup (nombres, montos, fechas) se reemplazan por datos reales del backend o de las fixtures.
- Desktop es la referencia (frames de 1440px). Mantené el comportamiento responsive existente y verificá que a 390px no haya scroll horizontal.

## Funcionalidad y backend

- Toda pantalla o estado nuevo tiene que ser funcional en el preview local (abajo).
- Si una función necesita datos que no existen en el esquema actual:
  1. Escribí una migración **nueva** en `supabase/migrations/<timestamp>_<nombre>.sql` usando el bloque de timestamps de tu área (en tu prompt). Aditiva, idempotente (`if not exists`), con RLS.
  2. Escribí su reversa en `supabase/rollbacks/<mismo-timestamp>_<nombre>.down.sql`.
  3. **No la apliques**: prohibido usar herramientas de Supabase que escriban (apply_migration, execute_sql con DDL/DML) o tocar el proyecto vivo.
  4. Agregá los métodos al repo de datos (preferí un repo nuevo de tu área en `public/shared/js/data/`). Si la tabla no existe en el backend real, el método tiene que degradar sin romper la página (mensaje claro, sin excepción no capturada).
  5. Agregá filas de ejemplo en tu archivo de fixtures `public/shared/js/demo-fixtures/<área>.js` (ya existe un stub) para que la pantalla funcione en el preview. Si la tabla es nueva, sumá su nombre a `ctx.TABLES`.
  6. Si la página nueva necesita cargar el repo, incluí el `<script>` en tu página respetando el orden de carga existente (config-manager → postgrest-client → repos).
- Endpoints del servidor: no edites `server.js`. Si hace falta un endpoint o una redirección, describilo en el reporte.
- Emails (plantillas en `templates/email/`): solo el área que lo tenga asignado.

## Concurrencia (hay otros 9 agentes trabajando en el mismo checkout)

- Editá **solo los archivos de tu área** (listados en tu prompt) y archivos nuevos que crees con prefijo propio.
- Archivos compartidos permitidos **solo para agregar** (sin reescribir ni reordenar): `public/shared/js/wo-tour-steps.js` (actualizá los pasos de tu página si cambiaste selectores), repos existentes de `public/shared/js/data/` (agregar métodos nuevos), tests nuevos en `tests/`. Antes de cada Edit en un archivo compartido hacé un Read fresco; nunca uses Write sobre un archivo compartido.
- **Git**: solo comandos de lectura (`git status`, `git diff`, `git log`, `git show`). Prohibido `commit`, `add`, `stash`, `checkout`, `switch`, `reset`, `restore`, `clean`, `rebase`, `merge`, `push`. El orquestador commitea por área.
- No borres archivos ni carpetas de rutas. No detengas ni reinicies el servidor de preview. No hagas deploy. No llames servicios externos reales.

## Preview local y verificación

- Servidor de preview seguro ya corriendo en `http://localhost:4647` (sesión de artista ficticia + datos ficticios, sin backend real). Las rutas se sirven como `http://localhost:4647/preview/preview-local-safe/<ruta>/`.
- Capturas full-height con Chrome headless (no compite con otros agentes):
  `bash output/figma-final-artista/tools/shot.sh "/artist/dashboard/" output/figma-final-artista/shots/<área>/<archivo>.png 1440 <alto> [espera_ms]`
  El alto tiene que cubrir la página completa (usá el alto del frame del Figma o más). Para estados (modales, tabs, pasos) exponé un parámetro de URL o hash que abra ese estado (ej. `?modal=nuevo-recordatorio`, `#paso-3`) y capturalo con ese URL. Es útil también para QA futuro: documentá esos parámetros en el reporte.
- Para interacción real (clicks, formularios, consola): podés usar el navegador integrado (`mcp__Claude_Browser__*`) **en una pestaña propia** creada con `tabs_create`, pasando siempre ese `tabId`. No uses ni cierres la pestaña `seed`.
- Comprobá con `read_console_messages` que tus páginas no tienen errores JS.
- Para cada frame: compará tu captura con la del Figma lado a lado (leé ambas imágenes) e iterá hasta que no queden diferencias visibles de layout, copy, jerarquía o color. Guardá la captura final de cada frame en `output/figma-final-artista/shots/<área>/<nodeid-con-guion>.png`.
- Tests: `node --test "tests/*.test.js"`. Línea base: 416 pass, 3 fail **preexistentes** (tests de PowerShell 7 de onboarding/setup, ajenos a esta tarea). Si tu cambio rompe un test de tu área, actualizá el test para el nuevo diseño (no lo borres sin reemplazo). Si agregás lógica pura nueva, sumá un test `tests/figma-final-<área>.test.js`.

## Rutas canónicas del flujo de artista (usalas en todos los links entre áreas)

| Área | Ruta |
| --- | --- |
| Inicio / elegir experiencia | `/bienvenida` |
| Iniciar sesión (+ estado "ya iniciaste sesión") | `/artist/login` |
| Crear cuenta | `/registerclosedbeta` |
| Registro 01–08 | `/register-artist` |
| Recuperar acceso | `/recover` |
| Dashboard (recordatorios, compartir perfil, QR, importar IG, menú de cuenta, notificaciones) | `/artist/dashboard` |
| Cotizaciones · listado | `/my-quotations` |
| Cotizaciones · nueva cotización manual + vista previa para el cliente (**ruta nueva**) | `/my-quotations/new` |
| Cotizaciones · detalle (estados) y notas de trabajo | `/my-quotations/detail?id=<quote_id>` |
| Estadísticas | `/my-quotations/statistics` |
| Calendario | `/calendar` |
| Cuenta (perfil, portafolio, cobros, disponibilidad, notificaciones, seguridad, verificación, configuración) | `/artist/account#<sección>` |
| Perfil público | `/artist/profile?username=<u>` (verificá el parámetro real en el código) |
| Job board (artista) | `/job-board` |
| Postulaciones | `/artist/applications` |
| Spots | `/studio-spots` |
| Invitaciones | `/artist/invitations` |
| Travel (+ itinerario público `/travel/t/<slug>`) | `/artist/travel` |
| Inbox | `/artist/inbox` |

Rutas que probablemente se eliminan (no las enlaces desde páginas nuevas): `/artist/profile/details` y `/artist/profile/gallery` (→ `/artist/account`), `/artist/visitors`, `/archive`, `/tutorial`, `/landing-tatuador`, `/quotations`.

## Reporte (obligatorio)

Al terminar escribí dos archivos:

1. `output/figma-final-artista/reports/<área>.json`:
```json
{
  "area": "<área>",
  "frames": [
    { "node": "801:542", "name": "Artista / Calendario - Vista mensual", "route": "/calendar",
      "result": "rediseñada | creada | estado-nuevo | sin-cambios",
      "summary": "qué cambió en una o dos frases",
      "figma_png": "output/figma-final-artista/frames/....png",
      "impl_png": "output/figma-final-artista/shots/<área>/....png",
      "state_url": "/calendar/?view=month",
      "fidelity": "exacta | alta | parcial", "fidelity_notes": "diferencias que quedan y por qué" }
  ],
  "removed_in_page": ["secciones/botones/tabs que quitaste porque no están en el Figma"],
  "routes_to_delete": [{ "route": "/x", "reason": "...", "redirect_to": "/y" }],
  "missing_functions": [{ "title": "...", "detail": "...", "severity": "alta | media | baja" }],
  "backend": [{ "migration": "supabase/migrations/...sql", "rollback": "supabase/rollbacks/...down.sql", "purpose": "...", "applied": false }],
  "copy_fixes": ["texto Figma → texto implementado"],
  "missing_assets": ["..."],
  "files_changed": ["..."],
  "files_created": ["..."],
  "tests": "resultado de node --test (pass/fail)",
  "notes": ["cualquier cosa que Isaí deba saber"]
}
```
2. `output/figma-final-artista/reports/<área>.md`: el mismo contenido en prosa breve para humanos.

Tu respuesta final al orquestador: 10 líneas como máximo (qué quedó hecho, qué no, riesgos) y la ruta del reporte.
