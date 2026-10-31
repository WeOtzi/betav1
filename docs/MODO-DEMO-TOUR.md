# Modo demo y recorrido guiado del artista

Fecha: 2026-09-03 · actualizado 2026-10-30 (demo para usuarios nuevos, sugerencia persistente, motor de voz nuevo y velocidad)
Alcance: las 14 páginas autenticadas del artista que cargan `wo-demo.js` (`/artist/dashboard`, `/artist/account`,
`/artist/applications`, `/artist/inbox`, `/artist/invitations`, `/artist/profile`, `/artist/travel`, `/calendar`,
`/job-board`, `/my-quotations`, `/my-quotations/detail`, `/my-quotations/new`, `/my-quotations/statistics`, `/studio-spots`).

Relacionados: [MODO-ASISTIDO.md](MODO-ASISTIDO.md) (configuración guiada del perfil, con datos reales) y
[VALIDACION-INSTAGRAM.md](VALIDACION-INSTAGRAM.md).

## Qué es

Un sandbox para tatuadores: al activarlo, la interfaz se llena de **cotizaciones,
turnos, diseños, postulaciones, spots, invitaciones, viajes, mensajes y
estadísticas de ejemplo**, y un **recorrido guiado narrado por voz** explica
sección por sección qué se puede ver y hacer en cada pantalla. Nada de lo que el
artista haga durante el demo se guarda en Supabase.

Entradas:

| Entrada | Qué hace |
| --- | --- |
| **Cuenta nueva** (auth creada hace ≤ 14 días) que entra al dashboard por primera vez | El demo y el recorrido se activan solos, sin recargar. Se marca `demo_auto_started` (espejo local + servidor) para no forzarlo de nuevo. |
| Tarjeta **"Probá We Ötzi con datos de ejemplo"** en el dashboard | Aparece en cada visita con el demo apagado, hasta que el artista la desactive desde el menú Ö. **AHORA NO** la oculta solo por esa sesión del navegador. |
| Menú Ö → **Recorrido guiado · modo demo** | Siempre visible. Con el demo apagado lleva a `/artist/dashboard?demo=1&tour=1`; con el demo prendido arranca el recorrido. |
| Menú Ö → **Sugerir el modo demo** (interruptor) | Prende o apaga la tarjeta de sugerencia en forma persistente (se guarda en el servidor). Si el guardado falla, el interruptor vuelve atrás y avisa. |
| Menú Ö → **Salir del modo demo** | Visible solo con el demo prendido. |
| `?demo=1` en cualquier página del artista | Activa el modo demo para la sesión del navegador (`sessionStorage`). |
| `?tour=1` (o `?demo=1&tour=1`) | Activa el demo y arranca el recorrido en el capítulo de esa página. |
| Barra inferior **MODO DEMO** | Botones RECORRIDO GUIADO, REINICIAR (vuelve a las fixtures iniciales) y SALIR DEL DEMO. |
| `?demo=0` | Sale del demo y limpia el estado. |
| Último paso del recorrido → **Salir del demo y configurar mi perfil →** | Sale del demo y entra al [modo asistido](MODO-ASISTIDO.md) en `/artist/account#perfil`. |

## Cómo funciona

```text
<head> de cada página del artista
  └─ wo-demo.js (antes de supabase-js y config-manager.js)
       ├─ lee ?demo / ?tour / ?asistido / sessionStorage.wo_demo_mode / espejo wo_onb_<uid>
       ├─ cuenta nueva en el dashboard sin demo_auto_started → prende el demo + recorrido en el lugar
       ├─ si está activo: parchea window.fetch ANTES de que config-manager cree el cliente
       │    (supabase-js captura la referencia a fetch al crearlo)
       ├─ carga lazy: wo-demo-postgrest.js + wo-demo-fixtures.js + demo-fixtures/*.js (datos)
       │              wo-tour.js + wo-tour-steps.js + wo-tour.css (recorrido)
       ├─ demo apagado: tarjeta de sugerencia (wo-onboarding.css) y cargador del modo asistido
       └─ sincroniza el espejo con GET /api/artist/onboarding (fetch nativo, nunca el emulado)
```

1. **Intercepción de datos.** Toda request a `/rest/v1/<tabla>` se resuelve en
   memoria con `wo-demo-postgrest.js`, un emulador del subconjunto de PostgREST
   que usa `window.WeotziData` y los `.from()` de página: `select` con alias y
   recursos embebidos (`studios:studio_id(...)`, `!inner`), filtros
   `eq/neq/gt/gte/lt/lte/like/ilike/is/in` + `not.` + `or=(...)`, `order` con
   `nullsfirst/nullslast`, `limit/offset`, `Prefer: count=exact` (HEAD y
   `content-range`), `Accept: vnd.pgrst.object` (mismo 406 `PGRST116` que
   PostgREST para `single()`/`maybeSingle()`), insert/upsert/update/delete con
   `return=representation` y RPCs con handlers JS.
2. **Qué se simula y qué no.** Las tablas de la lista `TABLES` de
   `wo-demo-fixtures.js` y de las extensiones `demo-fixtures/*.js` se sirven
   desde memoria. **`artists_db`, `artist_tattoo_locations`, `tattoo_styles` y
   demás catálogos se leen del backend real**, así el demo muestra el nombre,
   avatar y galería de quien está logueado. Las escrituras a tablas reales se
   ignoran (respuesta vacía exitosa), las RPCs de escritura sin handler
   devuelven `null`, las RPCs de lectura (`get_*`, `list_*`, `check_*`…) pasan al
   backend y las subidas a Storage se bloquean con un error legible.
3. **Si el emulador falla** (no cargaron las fixtures, error interno), las
   lecturas GET/HEAD caen al backend real, pero **ninguna escritura**: responden
   503 `DEMO_UNAVAILABLE`. Así una cuenta nueva que entró sola al demo nunca
   escribe datos reales por un error del sandbox.
4. **Identidad.** El `user_id` y la fecha de creación de la cuenta salen de la
   sesión de Supabase en `localStorage` (`sb-<ref>-auth-token`); el
   `username`/nombre se capturan de la respuesta real de `artists_db`.
5. **Persistencia dentro de la sesión.** Las mutaciones del demo se guardan en
   `sessionStorage.wo_demo_store` (12 h). REINICIAR las descarta.
6. **Fechas relativas.** Los cuatro turnos del día son siempre "hoy" (10:00,
   13:30, 16:00 y 18:30 hora local), los viajes se reparten entre pasado y
   futuro y las visitas cubren los últimos 30 días.

### Estado del onboarding (servidor + espejo)

Las elecciones del artista viven en `user_preferences.app_settings.onboarding`
(lo escribe solo el servidor, ver [MODO-ASISTIDO.md](MODO-ASISTIDO.md)):
`demo_suggestions`, `demo_auto_started_at` y `assisted.*`. Como `<head>` necesita
decidir sin esperar a la red, `wo-demo.js` mantiene un espejo en
`localStorage.wo_onb_<userId>` (`demo_suggestions`, `assisted_active`,
`demo_auto_started`, `synced_at`). El GET de sincronización corre en el
dashboard, con el modo asistido activo o cuando el espejo tiene más de 15
minutos; un 403 (sesión que no es de artista) solo sella `synced_at` para no
repetir la consulta en cada página, y los 5xx no tocan nada.

`window.WoDemo` expone, además de `enable/disable/reset/startTour`:
`appPath(path)`, `getAccessToken()`, `api(path, { method, body })` (fetch nativo,
Bearer y base path), `onboarding({ fresh })`, `suggestionsEnabled()`,
`setSuggestions(bool)`, `startAssist()`, `stopAssist()` y `disable({ assist, path })`.
Eventos en `document`: `wo:demo-suggestions-changed` y `wo:assist-changed`.

## El recorrido (wo-tour.js + wo-tour-steps.js)

- **Trece capítulos**, uno por página: Inicio → Cotizaciones → Expediente →
  Calendario → Job board → Spots → Invitaciones → Postulaciones → Estadísticas →
  Travel → Inbox → Centro de la cuenta → Perfil público. 92 pasos en total
  (incluye la validación de Instagram y la modalidad de trabajo del centro de
  la cuenta).
- Cada paso **oscurece toda la pantalla salvo la sección enfocada** (cuatro
  paneles de velo + marco), muestra la tarjeta y lo **lee en voz alta** con la
  Web Speech API (voz `es-AR` si existe; si no, otra `es-*`).
- Con la voz activa el recorrido **avanza solo** 0,9 s después de que la
  narración terminó de verdad. Sin voz se avanza con **SIGUIENTE →**, flechas o
  Enter. Esc sale. `+`/`=` y `-` cambian la velocidad.
- Al cambiar de página el estado se guarda en `sessionStorage.wo_tour_state` y
  el recorrido se retoma solo; el primer paso de cada página muestra
  **ESCUCHAR ▶** hasta que haya un click (regla de los navegadores).
- Si la pestaña se oculta o se bloquea la pantalla durante la narración, el
  recorrido **no avanza en silencio**: espera y, al volver, narra de nuevo el
  paso actual.

### Motor de voz (narrador)

Reemplaza la versión de septiembre, que a veces **cortaba el audio y avanzaba
sin terminar**. La causa era un temporizador de respaldo calculado por largo
del texto: cuando vencía antes que el audio daba la frase por terminada, el
avance automático se disparaba y cancelaba lo que seguía sonando. Ahora:

- El texto se parte en frases sin lookbehind (compatible con Safari < 16.4) y
  las de más de 160 caracteres se cortan en `,` `;` `:`.
- Cada frase tiene un único cierre (`settled`): un `onend` tardío, el error de
  nuestro propio `cancel()` o el vigilante no pueden avanzar dos veces.
- **Nunca se da una frase por terminada mientras `speechSynthesis.speaking` sea
  true.** Si se pierde el `onend`, el vigilante (cada 250 ms) cierra la frase
  tras 700 ms de silencio real.
- Una frase que no arranca se reintenta una vez y después se saltea: a los 5 s
  con el motor ocioso, o a los 20 s si el motor dice que habla pero nunca llegó
  `onstart`.
- `interrupted`/`canceled` ajenos y los demás errores reintentan la frase una
  vez y saltean solo esa frase (antes se abandonaba toda la narración).
- 120 ms entre `cancel()` y el siguiente `speak()`; referencias fuertes a la
  utterance activa (Chrome las descartaba); keep-alive `pause()/resume()` cada
  10 s solo para voces remotas en Chromium que no es Edge.

**Velocidad:** botón en la tarjeta (1×, 1,25×, 1,5×, 1,75×, 2×), guardada en
`localStorage.wo_tour_rate`. Cambiarla durante la narración repite la frase
actual a la nueva velocidad, no todo el texto.

`window.WoTour.narrator` (`speak`, `stop`, `isSpeaking`, `getRate`, `setRate`,
`RATES`, `formatRate`, `voiceEnabled`, `setVoiceEnabled`) lo comparte el panel
del modo asistido.

### Editar el guion

Todo el texto vive en `public/shared/js/wo-tour-steps.js`. Cada paso admite:

| Campo | Uso |
| --- | --- |
| `target` | Selector CSS o lista de selectores (gana el primero visible). `null` = tarjeta centrada sin foco. |
| `title`, `text` | Título y texto (string o array de párrafos). `speech` permite un texto distinto para la voz. |
| `hint` | Línea mono debajo del texto. |
| `before(ctx)` / `after(ctx)` | Preparan/cierran la interfaz. `before` puede devolver `false` para saltar el paso. |
| `interactive` | Deja clickeable la sección enfocada y no avanza solo. |
| `nextLabel`, `exitLabel`, `exitAssist` | Etiquetas de los botones; con `exitAssist: true` la salida pasa al modo asistido. |
| `waitFor`, `timeout` | Selector alternativo a esperar y tiempo máximo (ms). |

Copy: rioplatense con voseo, sentence case y sin signos de exclamación (regla 10
del DS). `tests/demo-tour.test.js` verifica que cada selector exista.

## Archivos

| Archivo | Rol |
| --- | --- |
| `public/shared/js/wo-demo.js` | Bootstrap: flags, demo para cuentas nuevas, parche de `fetch`, espejo y sincronización del onboarding, sugerencia, cargador del modo asistido. |
| `public/shared/js/wo-demo-postgrest.js` | Emulador PostgREST en memoria. |
| `public/shared/js/wo-demo-fixtures.js` + `demo-fixtures/*.js` | Fixtures del artista por área, relaciones, vistas y RPCs simuladas. |
| `public/shared/js/wo-tour.js` | Motor del recorrido y narrador de voz. |
| `public/shared/js/wo-tour-steps.js` | Guion (capítulos y pasos). |
| `public/shared/css/wo-tour.css` | Recorrido y barra demo. |
| `public/shared/css/wo-onboarding.css` | Tarjeta de sugerencia del demo. |
| `public/shared/js/wo-artist-menu.js` | Menú Ö: recorrido, modo asistido, salir del demo, interruptor de sugerencia. |
| `tests/demo-tour.test.js`, `tests/demo-onboarding.test.js`, `tests/tour-narrator.test.js` | Emulador, cableado, guion, decisiones del bootstrap y narrador con un `speechSynthesis` falso. |

El include `<script src="/shared/js/wo-demo.js?v=…">` va justo después del
`<meta name="viewport">`, antes de cualquier otro script. Al cambiar
`wo-demo.js`, subir el `?v=` en las 14 páginas y la constante `VERSION`.

## Limitaciones conocidas

- La voz depende del navegador: Edge y Chrome en Windows traen voces en
  español; Safari usa las del sistema. Sin voz en español el recorrido funciona
  en modo lectura. No se probó todavía en un iPhone ni en Chrome Android real.
- El espejo vive por navegador: una cuenta nueva que abre el dashboard por
  primera vez en otro navegador vuelve a ver el demo automático (la decisión se
  toma en `<head>`, antes de consultar al servidor).
- `artists_db` es real: si el artista no cargó galería, la del dashboard se ve
  vacía con su CTA.
- El realtime de Supabase sigue conectado a las tablas reales; en demo no llegan
  eventos.
- El preview local (`scripts/release/preview-server.cjs`) quita `wo-demo.js`
  por diseño: ahí no hay demo, sugerencia ni modo asistido.

## Verificación

```bash
node --test tests/demo-tour.test.js tests/demo-onboarding.test.js tests/tour-narrator.test.js
node --test "tests/*.test.js"
```

Prueba manual: con una sesión de artista, abrir
`http://localhost:4545/artist/dashboard?demo=1&tour=1`, recorrer los trece
capítulos (probar el botón de velocidad y bloquear la pantalla a mitad de una
frase en el celular) y salir con **Salir del demo y configurar mi perfil →**;
comprobar que la cuenta real quedó intacta.

## Rollback

Quitar el include de `wo-demo.js` de las 14 páginas desactiva el demo, la
sugerencia y el modo asistido. No hay migraciones involucradas en el demo.
