# Reporte · área dashboard (Figma final del flujo de artista, oct 2026)

Ruta: `/artist/dashboard` + topbar, menú de cuenta y notificaciones compartidos por todas las páginas del artista.
Capturas finales en `output/figma-final-artista/shots/dashboard/<nodo>.png` (con íconos Feather, servidor reiniciado).

## Frames

| Frame | Resultado | Fidelidad | Estado QA |
| --- | --- | --- | --- |
| 24:1425 Dashboard | rediseñada | alta | `/artist/dashboard/` |
| 801:559 Menú de cuenta | rediseñada | alta | `?menu=cuenta` |
| 801:558 Notificaciones | rediseñada | alta | `?menu=notificaciones` |
| 801:563 Recordatorio · ver | estado nuevo | alta | `?modal=recordatorio&id=…` |
| 801:560 Recordatorio · nuevo | estado nuevo | exacta | `?modal=nuevo-recordatorio` |
| 801:1109 Recordatorio · editar | estado nuevo | exacta | `?modal=editar-recordatorio&id=…&iconos=1` |
| 801:561 Tarjeta QR | estado nuevo | alta | `?panel=qr[&destino=galeria]` |
| 801:562 Compartir perfil | estado nuevo | alta | `?panel=compartir` |
| 2003:1191 / 1902 / 2583 Importar IG | rediseñada + 2 estados nuevos | alta | `?ig=1` · `?ig=2` · `?ig=3` (en el preview importa la muestra) |
| 2003:862 Galería de trabajos | rediseñada (rondas 1-2) | alta | `/artist/dashboard/` · `?ig=3` para ver NUEVO · IG |

**Qué cambió.** Rail al spec del Figma: perfil, ingresos, **recordatorios** (ícono, fecha, chip de prioridad, punto rojo de importante, `+ NUEVO RECORDATORIO`) y **5 acciones rápidas**:
- *Nuevo cliente* → `/my-quotations/new?origen=cliente`
- *Nueva cita* → `/my-quotations/new?origen=cita`
- *Registrar pago* → `/artist/account#cobros`
- *Compartir mi perfil* y *Generar tarjeta QR* abren paneles laterales.

La topbar ya no tiene *MODO CLIENTE* ni el chevron de *SPOTS*. Menú de cuenta y notificaciones como en el Figma, con datos reales. Se sumaron *Postulaciones* (job board + spots), *Reserva confirmada* y los recordatorios que vencen hoy o mañana. Importar Instagram pasó a un diálogo de 3 pasos que también usan los registros.

**Funciona de punta a punta en el preview:**
- Recordatorios: crear, ver, editar (texto, fecha, ícono, prioridad, importancia), marcar hecho o reabrir y borrar con doble confirmación.
- Compartir: copiar enlace, WhatsApp, mail, Instagram (copia el link) y compartir nativo.
- QR: descargar la tarjeta en PNG y en SVG.
- Importar Instagram: el preview simula la importación y la galería pasa de 3 a 6 trabajos.

**Diferencias que quedan:**
- *MARCAR HECHO* en el detalle no está en el Figma; se agregó porque *completar* es un requisito funcional.
- La URL compartida es la real (`/artist/profile?artist=<u>`), no `weotzi.com/<u>`.
- El badge del tile muestra las notificaciones sin leer; el mock muestra la suma de las filas.
- La galería ahora sigue 2003:862 (ronda 1); los datos ficticios tienen menos trabajos y sin nombre.

## Ronda 1 · correcciones del auditor

**Corregido (capturas nuevas en `shots/dashboard/`, comparadas con `frames/24-1425_dashboard-1440.png` y `frames/2003-862_galeria.png`):**
- **Galería (P1, 2003:862)** — módulo nuevo `public/shared/js/dashboard-gallery.js` (UMD, probado en node). Mosaicos de 180px en 4 columnas con gap 16, leyenda con el nombre del trabajo (Inter 13 semibold sobre #24211d al 88 %) y papelera de 28px; contador `N/12 ARCHIVOS · N/2 VIDEOS`; insignia `VIDEO · 0:24` con ojo; `NUEVO · IG` con borde amarillo de 3px durante 7 días después de importar; dropzone `+ / SUBIR MÁS · / N LIBRES` (click o soltar archivos); IMPORTAR INSTAGRAM 52px/14px; CTA 32px y bajada 16px `#d8d0bf`. Se quitaron VISTA PREVIA, REALIZADO y el grupo ★/✎/×.
  - Sigue funcionando subir y borrar; **destacar** = ★ que aparece en hover/foco (o arrastrar al primer lugar); **reordenar** = arrastrar o Alt + flechas; **renombrar** = click en el nombre (Enter guarda, Escape cancela). Probado en el navegador: renombrar, destacar, mover con teclado, arrastrar, borrar, abrir el visor y la dropzone.
  - Datos en `artists_db.gallery_feed_items` (JSON, sin migración): `title`, `duration`, `source`, `imported_at`. La normalización del feed ya no descarta campos (antes perdía el `permalink` de IG al guardar).
- **Tipografía de la columna principal (P1)** — escalada al render del Figma: hero 56px con interlínea 58, fecha 12px, h2 24px, agenda 26/18/14px con filas de 87px, chips 10px, diseños 15/13/11px con barra de 6px, cotizaciones 46px, actividad 14px.
- **Resaltado del hero (P1)** — el fondo amarillo se limita a su línea: ya no tapa la coma de "Buen día," ni la "y" de "Hoy" (también a 390px).
- **Topbar (P1/P2, todas las páginas)** — sin badge en COTIZACIONES ni en INBOX en escritorio (los pendientes quedan en el menú móvil); tile Ö y LOG OUT a 31px y 33px del borde (medido: tile 1230, LOG OUT 1304–1407, igual que el Figma); en ≤480px el contador del tile queda dentro de la barra y no pisa LOG OUT.
- **Footer (P1)** — Preguntas frecuentes → `https://weotzi.com/faqs/#tatuadores`, Centro de ayuda → `https://weotzi.com/faqs/`, Soporte → `/artist/inbox?filter=support`. Términos y Privacidad apuntan a `/legal/terms` y `/legal/privacy` (las mismas del registro), que **todavía no existen** (ver pendientes).
- **P2 corregidos**: barra de avance por etapa (BOCETO azul, ENTINTADO amarillo, FINAL verde); nombre del rail y de la vista previa de compartir sin `.wo`; tarifa `$180 / SESIÓN`; actividad en una línea con "…"; `Sesión N/T` y `NO ASISTIÓ`; diálogo de Instagram centrado (paso 01 en y=109, paso 03 en y=247) y por encima de la topbar del wizard de `/register-artist`; íconos y X de los paneles Compartir/QR centrados; sin anillo azul de foco sobre paneles y diálogos al abrirlos; a 390px el body reserva el alto de la barra inferior y INSTAGRAM del footer queda alcanzable; notificaciones de Recordatorio con ícono de calendario.

**No corregido:**
- *MARCAR HECHO / REABRIR* en el detalle del recordatorio (801:563): decisión de diseño pendiente; sin él no hay forma de completar un recordatorio.
- *REGISTRAR PAGO*: anotar cobros en `artist_financial_entries` inflaría el saldo retirable de la wallet (las entradas `income` se muestran como fondos liberados) y el RLS no deja escribir al artista. Hace falta definir el modelo y el frame.
- `/artist/account` con margin de 8px en el body: es CSS del área cuenta (`artist-account-ds.css`).
- Páginas legales: no hay contenido ni ruta en ningún lado.

**Nuevos parámetros/QA:** `?ig=3` en el preview importa la muestra (3 trabajos, uno es reel de 18 s) para ver la galería con NUEVO · IG.

## Ronda 2 · correcciones del auditor

**Corregido (capturas nuevas en `shots/dashboard/`):**
- **Columna principal de 24:1425 (P1).** El hallazgo era correcto: entre la última fila de la agenda y la regla negra había 32px y el Figma tiene 56px, así que todo lo de abajo subía unos 38px. Medido al píxel a 1440 desde el borde de la topbar:
  - Agenda: filas de 87px, la primera de 96px. Hora, nombre y chip están alineados arriba, como en el Figma (antes iban centrados y el nombre quedaba 10px más arriba).
  - La regla negra queda en 685 (Figma 685). Cards en 766 (766), título Cotizaciones en 1107 (1108), cifras en 1205 (1206), Actividad reciente en 1115 (1116).
  - Barra de avance de 8px: en el Figma no es de 6px.
  - Columnas Cotizaciones/Actividad de 560/320px. Celdas de 216/232/112px. Cifras en x 77/308/542 (Figma 76/307/541).
  - La hora de la actividad va pegada al texto, como en el Figma, y no alineada a la derecha.
  - En 390px, la fecha ya no se superpone con el saludo, el chip queda pegado al detalle y las cifras de Cotizaciones quedan alineadas.
- **Subida de la galería (P1, 2003:862).**
  - `uploadDashboardGalleryFile()` sube al bucket `artist-gallery` en producción.
  - En el preview, que no emula Storage, el archivo queda en el navegador como `data:` URL (las imágenes se reducen a 900px). Antes la subida fallaba y no le avisaba nada al artista; ahora informa éxito, subida parcial o fallo.
  - El tope de 2 videos usa la misma regla que el contador `N/2 VIDEOS` (el `kind` del ítem). Así cuentan también los reels de IG con miniatura .jpg.
  - Verificado con Chrome por CDP:
    - subir por el input (2 PNG + 1 MP4);
    - soltar un PNG en SUBIR MÁS;
    - destacar, Alt+→, renombrar y borrar;
    - persistencia al recargar;
    - tope de videos con reels de IG.
  - Sin errores de consola.
- **(a) Galería según 2003:1191 / 1902 / 2583.** Ya estaba hecha en la ronda 1 y sigue igual:
  - leyenda y papelera abajo de cada mosaico;
  - contador `N/12 ARCHIVOS · N/2 VIDEOS` a la derecha;
  - `VIDEO · 0:18`;
  - `NUEVO · IG` con borde amarillo;
  - `SUBIR MÁS · N LIBRES`;
  - sin VISTA PREVIA.

  Capturas compuestas nuevas: `2003-1191.png`, `2003-1902.png`, `2003-2583.png` y `2003-862.png`. Esta última muestra la galería después de `?ig=3` más una subida.
- **(b) Diálogo de Instagram en `/register-artist`.**
  - La z-index ya tapaba la topbar del wizard (ronda 1); se verificó a 1440 y 390.
  - Se corrigió el ancho en móvil: el diálogo es border-box y el overlay deja lugar a la sombra, así no hay scroll horizontal.
  - Evidencia: `2003-1191-register-artist-1440.png` y `-390.png`.
- **(c) Badge del tile Ö en móvil.**
  - En ≤480px queda dentro de la barra de 56px y a 5px de LOG OUT, aun con "99+".
  - Evidencia con viewport exacto: `topbar-badge-mobile-320-360-390.png`.
  - Ojo: `shot.sh` a 390 arma la página con unos 500px de ancho y recorta la captura, por eso el badge parecía desbordar.

**No corregido:**
- **Footer · Términos y Privacidad (P1).** `/legal/terms` y `/legal/privacy` siguen dando 404:
  - no hay texto legal ni ruta en el repo;
  - las mismas URLs las usan el registro, el dashboard del cliente y `molecules.js`;
  - hace falta el contenido de la empresa en `public/legal/{terms,privacy}/index.html` o un redirect en `server.js`, y los dos quedan fuera de esta área.
- **Videos subidos en el preview.** La CSP del preview (sin `media-src`) bloquea los videos `data:`/`blob:`: se cargan y cuentan, pero no se reproducen ni muestran su duración. En producción van a Storage.

## Backend
- `supabase/migrations/20261028110000_artist_reminders.sql` (**no aplicada**):
  - tabla `artist_reminders` con RLS por dueño y grants mínimos;
  - bucket privado `artist-reminder-files`, con la carpeta raíz igual al uid del artista;
  - copia de los recordatorios que hoy viven en `user_preferences.app_settings.reminders`.
- Reversa: `supabase/rollbacks/20261028110000_artist_reminders.down.sql`. Devuelve los recordatorios a `user_preferences` antes de borrar la tabla.
- Repo nuevo `public/shared/js/data/reminders-repo.js` (`WeotziData.Reminders`). Sin la migración guarda en `user_preferences` con el mismo formato y la página no se rompe. Los adjuntos se deshabilitan con un mensaje claro.
- Fixtures: `demo-fixtures/dashboard.js` agrega `artist_reminders` (4 filas como en el Figma, con fechas relativas a hoy) y una muestra de Instagram para el preview.

## Quitado de la página
- Botón *MODO CLIENTE* de la topbar del artista. Cliente y estudio lo conservan.
- Chevron y desplegable de *SPOTS*. *Invitaciones* sigue en el menú de cuenta y en el menú móvil.
- Modal QR legacy.
- Fila *Solicitudes pendientes*, reemplazada por *Postulaciones*.
- Link *Recorrido guiado*: solo aparece con el modo demo activo.
- *Nuevo cliente* ya no va al cotizador público.

## Rutas a eliminar (propuesta)
- `/artist/visitors` → `/my-quotations/statistics`. Al borrarla, quitar el link *VISITANTES* de `dashboard-extras` en `organisms.js`.
- `/artist/profile/details` → `/artist/account#perfil`. `dashboard.js` todavía se carga ahí.
- `/artist/profile/gallery` → `/artist/profile?artist=<u>#block-gallery`.

## Funciones faltantes
- **Alta (ronda 1)**: páginas legales `/legal/terms` y `/legal/privacy` (no existen; el footer y el registro las enlazan).
- **Baja (ronda 1)**: el servidor no guarda `source`/`imported_at`/`duration` al importar de IG (el dashboard los sella después); reordenar con touch.
- **Alta**: `/api/instagram/preview` no devuelve la lista de publicaciones.
  - Hay que sumar `summary.media` en `lib/instagram-import.js` con `permalink`, `kind`, `thumbnail_url` y `video_duration`.
  - El front ya lo usa. Sin eso, el paso 02 cae a selección por tipo (fotos o videos).
- **Media**:
  - URL corta `weotzi.com/<u>`: falta un redirect en el servidor.
  - Flujo real de *Registrar pago*: no hay frame.
- **Baja**:
  - Notificación *Contraoferta recibida*: no hay un método por artista.
  - Avisos de recordatorios por email o push.
  - Subida de adjuntos de recordatorios: no está simulada en el preview.
  - Videos de la galería en el preview (ronda 2): la CSP del preview no deja reproducir `data:`/`blob:`.
  - Filtro `?filtro=soporte` en el Inbox para el link *Ayuda*.

## Copy corregido
- Plurales del paso 03: *Te queda 1 espacio libre* / *Te quedan N espacios libres*.
- Contadores en singular cuando corresponde: *1 ESPACIO LIBRE*, *SELECCIONADA*, *PUBLICACIÓN*.

## Notas
- `<weotzi-product-nav>` y `<weotzi-product-footer>` están definidos en `public/shared/js/ds/organisms.js`, no en `site-components.js`. Solo se tocó `renderProductNav`. El footer ya coincidía con el Figma.
- La burbuja de soporte aparece en los frames 2003:* (*Abrir soporte*); el orquestador ya la quitó desde `support-loader.js`.
- Los grises claros del Figma no cumplen WCAG AA; se respetaron tal cual.
- El componente de Instagram trae sus propios SVG y valores de respaldo para los tokens, porque `/studio/register` no carga el DS.

## Tests
- Ronda 2: suite completa **620 tests · 616 pass · 3 fail** (solo las 3 preexistentes de PowerShell 7). `tests/figma-final-dashboard.test.js` 26/26. Los 5 tests nuevos cubren:
  - el conteo de videos, igual al del contador;
  - la subida a `artist-gallery` y los mensajes de resultado;
  - la subida en el preview;
  - los espaciados de 24:1425;
  - el badge móvil y el diálogo de IG en border-box.
- Ronda 1: suite completa **592 tests · 588 pass · 3 fail** (solo las 3 preexistentes de PowerShell 7). `tests/figma-final-dashboard.test.js` 21/21 (6 nuevos de galería, copy y estilos); `tests/components-catalog.test.js` 17/17 (topbar sin contadores de escritorio, footer sin rutas 404).
- Ronda 0: `tests/figma-final-dashboard.test.js`: 15/15.
- Se actualizaron `tests/components-catalog.test.js` (SPOTS sin desplegable) y `tests/demo-tour.test.js` (recorrido solo en modo demo).
- Suite completa: **505 pass / 8 fail**. Ninguna falla es de esta área:
  - 3 son las preexistentes de PowerShell 7;
  - `hidden-overlays` falla por `quotation-new.css` (área cotizaciones);
  - 4 de `invitations-figma` (área invitaciones, en curso).
