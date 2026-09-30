# Modo demo y recorrido guiado del artista

Fecha: 2026-09-03
Alcance: páginas autenticadas del artista (`/artist/*`, `/my-quotations*`, `/calendar`, `/job-board`, `/studio-spots`, `/archive`).

## Qué es

Un sandbox para tatuadores: al activarlo, la interfaz se llena de **cotizaciones,
turnos, diseños, postulaciones, spots, invitaciones, viajes, mensajes y
estadísticas de ejemplo**, y un **recorrido guiado narrado por voz** explica
sección por sección qué se puede ver y hacer en cada pantalla. Nada de lo que el
artista haga durante el demo se guarda en Supabase.

Entradas:

| Entrada | Qué hace |
| --- | --- |
| `?demo=1` en cualquier página del artista | Activa el modo demo para la sesión del navegador (`sessionStorage`). |
| `?tour=1` (o `?demo=1&tour=1`) | Activa el demo y arranca el recorrido en el capítulo de esa página. |
| Menú Ö → **Recorrido guiado · modo demo** | Lleva a `/artist/dashboard?demo=1&tour=1`. |
| Tarjeta "¿Primera vez acá?" en el dashboard | Aparece una vez a artistas que nunca hicieron el recorrido (`localStorage.wo_tour_seen`). |
| Barra inferior **MODO DEMO** | Botones RECORRIDO GUIADO, REINICIAR (vuelve a las fixtures iniciales) y SALIR DEL DEMO. |
| `?demo=0` | Sale del demo y limpia el estado. |

## Cómo funciona

```text
<head> de cada página del artista
  └─ wo-demo.js (antes de supabase-js y config-manager.js)
       ├─ lee ?demo / ?tour / sessionStorage.wo_demo_mode
       ├─ si está activo: parchea window.fetch ANTES de que config-manager cree el cliente
       │    (supabase-js captura la referencia a fetch al crearlo)
       ├─ carga lazy: wo-demo-postgrest.js + wo-demo-fixtures.js (datos)
       │              wo-tour.js + wo-tour-steps.js + wo-tour.css (recorrido)
       └─ pinta la barra MODO DEMO y retoma el recorrido si venía de otra página
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
   `wo-demo-fixtures.js` (cotizaciones, sesiones, adjuntos, chat, job board,
   estudios/spots/invitaciones, travel, calendario, visitas, reseñas, inbox
   unificado, centro de la cuenta) se sirven desde memoria. **`artists_db`,
   `artist_tattoo_locations`, `tattoo_styles` y demás catálogos se leen del
   backend real**, así el demo muestra el nombre, avatar y galería de quien está
   logueado. Las escrituras a tablas reales se ignoran (respuesta vacía exitosa),
   las RPCs de escritura sin handler devuelven `null`, las RPCs de lectura
   (`get_*`, `list_*`, `check_*`…) pasan al backend y las subidas a Storage se
   bloquean con un error legible ("Modo demo: nada se guarda").
3. **Identidad.** El `user_id` sale de la sesión real de Supabase en
   `localStorage` (`sb-<ref>-auth-token`) o del JWT de la primera request; el
   `username`/nombre se capturan de la respuesta real de `artists_db`. Las
   fixtures se generan para ese `user_id`, por eso los filtros
   `artist_id=eq.<uuid>` de cada página coinciden.
4. **Persistencia dentro de la sesión.** Las mutaciones (responder una
   cotización, mandar un mensaje, marcar favorito) se guardan en
   `sessionStorage.wo_demo_store` (12 h) y sobreviven a la navegación entre
   páginas. REINICIAR las descarta.
5. **Fechas relativas.** Los cuatro turnos del día son siempre "hoy" (10:00,
   13:30, 16:00 y 18:30 hora local), los viajes se reparten entre pasado y
   futuro y las visitas cubren los últimos 30 días.

## El recorrido (wo-tour.js + wo-tour-steps.js)

- **Trece capítulos**, uno por página, en este orden: Inicio → Cotizaciones →
  Expediente → Calendario → Job board → Spots → Invitaciones → Postulaciones →
  Estadísticas → Travel → Inbox → Centro de la cuenta → Perfil público. Más de
  80 pasos en total.
- Cada paso **oscurece toda la pantalla salvo la sección enfocada** (cuatro
  paneles de velo + marco con el número de paso), muestra la tarjeta con el
  texto y lo **lee en voz alta** con la Web Speech API (voz `es-AR` si existe;
  si no, `es-MX/es-US/es-ES` o cualquier `es-*`). Entre paso y paso el velo se
  retira, se hace scroll a la sección siguiente y vuelve a cerrarse.
- Con la voz activa el recorrido **avanza solo** al terminar la narración
  (0,9 s de pausa); con la voz apagada, o si el navegador no tiene voz en
  español, se avanza con **SIGUIENTE →**, flechas del teclado o Enter. Esc sale.
- Al cambiar de página el estado (capítulo/paso) se guarda en
  `sessionStorage.wo_tour_state` y el recorrido se retoma solo. Como los
  navegadores exigen un click en cada documento nuevo antes de reproducir voz,
  el primer paso de cada página muestra **ESCUCHAR ▶** hasta ese click.
- Pasos con estado previo (menú Ö, editor del calendario, secciones del centro
  de la cuenta) usan hooks `before`/`after` en el guion. Si una sección no
  aparece en 9 s (por ejemplo, un contenedor vacío) el paso se salta con un
  aviso en consola en vez de bloquear el recorrido.
- Las preferencias de voz y avance automático viven en `localStorage`
  (`wo_tour_voice`, `wo_tour_auto`).

### Editar el guion

Todo el texto vive en `public/shared/js/wo-tour-steps.js`. Cada paso admite:

| Campo | Uso |
| --- | --- |
| `target` | Selector CSS o lista de selectores (gana el primero visible). `null` = tarjeta centrada sin foco. |
| `title`, `text` | Título y texto (string o array de párrafos). `speech` permite un texto distinto para la voz. |
| `hint` | Línea mono debajo del texto. |
| `before(ctx)` / `after(ctx)` | Preparan/cierran la interfaz. `before` puede devolver `false` para saltar el paso. |
| `interactive` | Deja clickeable la sección enfocada y no avanza solo. |
| `nextLabel`, `exitLabel` | Etiquetas de los botones (la última pantalla usa `exitLabel` para salir del demo). |
| `waitFor`, `timeout` | Selector alternativo a esperar y tiempo máximo (ms). |

Copy: rioplatense con voseo, sentence case y sin signos de exclamación (regla 10
del DS). El test `tests/demo-tour.test.js` verifica que cada selector del guion
exista en el markup o en el script que lo pinta.

### Audio grabado (opcional, a futuro)

`wo-tour.js` usa la voz del navegador para no depender de servicios externos.
Si se quiere narración profesional, se puede agregar un campo `audio` por paso
(URL de un MP3, por ejemplo generado con ElevenLabs) y reproducirlo en lugar
de `speechSynthesis`; el motor ya aísla la narración en `narrate()`/`speak()`.

## Archivos

| Archivo | Rol |
| --- | --- |
| `public/shared/js/wo-demo.js` | Bootstrap: flag del modo, parche de `fetch`, identidad, carga lazy, barra e invitación. |
| `public/shared/js/wo-demo-postgrest.js` | Emulador PostgREST en memoria (puro, con tests en Node). |
| `public/shared/js/wo-demo-fixtures.js` | Fixtures del artista + relaciones, vistas calculadas y RPCs simuladas. |
| `public/shared/js/wo-tour.js` | Motor del recorrido: velo, marco, tarjeta, voz, navegación entre páginas. |
| `public/shared/js/wo-tour-steps.js` | Guion (capítulos y pasos). |
| `public/shared/css/wo-tour.css` | Estilos del recorrido y de la barra demo, solo con tokens del DS. |
| `public/shared/assets/demo/*.svg` | Placeholders Bauhaus para referencias, portadas de spots y logos de estudios. |
| `tests/demo-tour.test.js` | Emulador, fixtures, cableado de páginas, CSS y guion. |

Las páginas cableadas son las 15 superficies del artista más `/archive`; el
include `<script src="/shared/js/wo-demo.js">` va justo después del
`<meta name="viewport">`, antes de cualquier otro script.

## Limitaciones conocidas

- La voz depende del navegador: Edge y Chrome en Windows traen voces en
  español (Edge incluye `es-AR` natural); Safari usa las voces del sistema. Sin
  voz en español el recorrido funciona solo en modo lectura.
- `artists_db` es real: si el artista todavía no cargó galería, la sección
  "Galería de trabajos" del dashboard se muestra vacía con su CTA (el resto del
  dashboard sí tiene datos demo).
- El cliente realtime de Supabase sigue conectado a las tablas reales; en demo
  no llegan eventos (no hay escrituras), así que las vistas no se actualizan
  "solas" desde otros dispositivos.
- Las imágenes del demo son placeholders SVG en estilo Bauhaus, no fotos de
  tatuajes reales. Se pueden reemplazar en `public/shared/assets/demo/`.

## Verificación

```bash
node --test tests/demo-tour.test.js      # emulador, fixtures, cableado, guion
node --test "tests/*.test.js"            # suite completa
```

Prueba manual: iniciar sesión como artista, abrir
`http://localhost:4545/artist/dashboard?demo=1&tour=1`, recorrer los trece
capítulos y salir con **SALIR DEL DEMO**; comprobar que la cuenta real quedó
intacta (sin cotizaciones `DEMO-*`, sin viajes ni mensajes nuevos).

## Rollback

Quitar el include de `wo-demo.js` de las 16 páginas (o borrar los seis
archivos nuevos) desactiva por completo el modo demo; no hay migraciones ni
datos remotos involucrados.
