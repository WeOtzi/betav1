# Calendario · Figma final (801:542 – 801:554)

Ruta: `/calendar`. Los 12 frames están implementados y se pueden capturar por URL. Las capturas finales están en `output/figma-final-artista/shots/calendario/<nodo>.png`.

## Qué cambió

- **Mes, semana y día (801:542/544/545).** Ajusté tabs, divisor, navegación, búsqueda y leyenda a las medidas del Figma. La grilla mensual tiene bordes de 1,6 px y los días de otro mes aparecen atenuados. En la semana: cabeceras arena, filas de 52,8 px y bloques compactos. En el día: título arena separado de la grilla y filas de 65,6 px. "Próximos eventos" tiene la tipografía del Figma y un marcador punteado para las solicitudes. Los íconos ahora son Feather (`data-wo-icon`).
- **Elegir tipo (801:546) y los ocho formularios (801:547–554).** Ajusté espaciados, puntos de color, botón deshabilitado, selects con chevron y la fila de interruptor de 67 px. El resumen muestra el tipo elegido; el Figma repetía siempre "Turno con cliente".
- **Turno con cliente (801:547), estado nuevo.** Combobox "Cotización a vincular *" con búsqueda sin acentos, grupos (Aprobadas y en progreso / Sin aprobar · solo como reserva pendiente / No disponibles para agendar), badges, resumen de sesiones ("Sesión 2 de 3 agendada · 14 jul") y uso por teclado. También el link "Crear cotización manual" a `/my-quotations/new`.
- **Todos los tipos se guardan, se ven en las tres vistas, se editan y se borran.** Lo verifiqué en el preview: 7 tipos manuales más turno-sesión y turno-reserva. En semana y día, los eventos de todo el día van en una franja propia ("Todo el día") entre la cabecera y las 09:00.

## Correcciones de la auditoría (ronda 1)

- **Minicalendario del editor (P1, 801:546–554).** Las semanas reparten la caja de 326 px: el paso entre filas es de 46 px y el día elegido mide 44×44, como el Figma (antes 37 px y 44×35, con una franja vacía abajo). Con meses de 6 semanas las filas se achican sin desbordar.
- **Eventos de todo el día (801:544/545).** Ya no están en posición absoluta sobre las 09:00. Tienen una fila propia en la grilla y la elipsis se ve. Un turno de las 09:00 queda visible debajo.
- **Vista mensual (801:542).** El "+N" cuenta todos los eventos del día (el 28/10 muestra +2). Hoy va en tinta con una barra amarilla de 2,4 px del ancho del número, sin azul.
- **Detalles de color y tipografía.**
  - Separador tinta de 1,6 px en la columna de horas.
  - "Nuevo evento" con tracking de 1,12 px y texto #FAF8F3.
  - "Resumen del evento" en #B9AE98.
  - Fecha en Inter 14 con ícono tinta.
  - Cancelar y Guardar con borde de 1 px.
  - Notas sin agarrador de resize.
  - "Posible superposición" de 83 px, que crece si hay varias.
  - Asterisco gris en "Cotización a vincular".
- **Editor.** El fondo arena va de borde a borde, sin bandas blancas a los lados.
- **Turno con la lista cerrada (801:547).** Ya no se ven la ayuda genérica ni el link fijo "Crear cotización manual". La ayuda queda como descripción accesible y solo se muestran los avisos reales, como "se guarda como reserva pendiente". El link aparece en tres casos:
  - en el estado vacío de la lista;
  - cuando no hay cotizaciones agendables;
  - dentro del aviso, si se intenta guardar sin cotización.
- **Comportamiento.**
  - Sin sesión, redirige a `/artist/login?returnTo=%2Fcalendar`.
  - Se quitó el atajo que abría el 7/7/2026 para la cuenta real `isainazartattoo.wo`; para demos se usa `?date=`.
  - La barra de scroll vertical vuelve a verse.
  - La agenda agrupa los eventos que empezaron antes del período bajo el primer día visible y pone mayúscula inicial en los encabezados.

## Correcciones de la auditoría (ronda 2)

- **Bloques cortos en semana y día (P1, 801:544/545).** El hallazgo decía que "Pedir cartuchos 3RL" se veía completo. Era al revés: un turno de 30 min mide 26,4 px en la semana y 32,8 px en el día, y el título quedaba cortado por la mitad. Pasaba lo mismo con el 18:30–19:15. Ahora `calendar.js` mide el alto de cada bloque al dibujarlo y cada vez que cambia el tamaño de la vista, y elige un formato que entre:
  - una sola línea "09:30 Pedir cartuch…" cuando no entran hora y título;
  - hora más el título recortado con elipsis en la última línea completa ("Sesión — Valentina…");
  - en la vista día, el cliente se oculta si no entra; desde 1 h se ve hora, título y cliente, como el Figma.

  Lo medí sin recortes a 1440, 1700, 1100 y 390 px, y también al agrandar la ventana sin recargar. El Figma no tiene turnos de menos de una hora: el formato de una línea es una decisión propia, con la misma tipografía. Captura del caso corto: `shots/calendario/801-545-30oct.png`.
- **Link "Crear cotización manual" duplicado (P1, 801:547).** Después de Guardar sin cotización se veía dos veces: en el aviso y en el párrafo fijo. Ese párrafo seguía visible aunque ya hubiera una cotización elegida. Ahora:
  - el link va solo dentro del aviso;
  - al elegir una cotización desaparecen el aviso y el link;
  - el párrafo fijo aparece solo cuando no hay ninguna cotización agendable.
- **Avisos con la lista cerrada (801:547).** La confirmación "Se agenda como sesión de DEMO-D01…" no estaba en la lista de avisos de la ronda 1 y ya no se muestra; queda como descripción accesible del campo. Solo se ven los avisos que piden atención: reserva pendiente, error de carga y turno heredado sin cotización.
- **Verificación.** Probé 801:547 con un Chrome headless propio (el navegador integrado no tenía pestañas libres):

  | Paso | Resultado |
  | --- | --- |
  | Al abrir | Sin ayuda ni link |
  | Guardar sin cotización | Un solo link, dentro del aviso |
  | Elegir DEMO-D01 (aprobada) | Sin links ni avisos |
  | Elegir DEMO-P01 (sin aprobar) | Aviso de reserva pendiente |
  | Buscar algo sin resultados | Estado vacío con el link |

  No hubo errores de consola. Capturas: `801-547-closed.png` y `801-547-error.png`.

## Relación con otras áreas

- **Cotizaciones.** Un turno con una cotización aprobada se guarda como fila de `quotation_sessions`: el detalle de la cotización lo ve, y se edita y borra desde el calendario. Con una cotización sin aprobar se guarda como reserva pendiente en `artist_calendar_events`, con `quotation_id`. Si después se aprueba, al editar la reserva pasa a ser sesión, sin duplicados. Las cotizaciones rechazadas, vencidas o completadas no se pueden elegir.
- **Travel.** Los viajes se muestran solo lectura y al tocarlos abren `/artist/travel?trip=<id>`.
- **Recordatorios del dashboard.** Ya existe `artist_reminders` (con fecha, sin hora ni repetición). El formulario 801:553 necesita hora y "Se repite", así que el recordatorio del calendario sigue en `artist_calendar_events`. El calendario además muestra los recordatorios del dashboard en solo lectura, con link a `/artist/dashboard?modal=recordatorio&id=<id>`. Propuesta de unificación: agregar `due_time` y `recurrence_rule` a `artist_reminders` y migrar las filas `reminder`.

## Parámetros de URL

`?view=month|week|day|agenda` · `?date=YYYY-MM-DD` · `?new` (elegir tipo) · `?new=turno|reserva|disponibilidad|bloqueo|guest-spot|convencion|recordatorio|personal` · `?quote=<quote_id|id>` (también acepta `&new=appointment`, que es lo que envía hoy el detalle de cotización) · `?event=<uuid>` o `?event=session:<id>` · `?picker=open` · `?q=<texto>`.

## Backend (no aplicado)

- `supabase/migrations/20261028140000_calendar_quote_links.sql` agrega:
  - `artist_calendar_events.quotation_id`, con FK, índice y políticas que exigen que la cotización sea del mismo artista;
  - `quotation_sessions.location`.
- Reversa: `supabase/rollbacks/20261028140000_calendar_quote_links.down.sql`.
- Sin la migración, el repo reintenta sin esas columnas y la referencia a la cotización queda en las notas.
- Fixtures en `demo-fixtures/calendario.js`: los 7 tipos manuales en el mes y la semana actuales, más una reserva vinculada.

## Pendiente o a decidir

- `/my-quotations/new` ya existe y el link "Crear cotización manual" funciona.
- **Decisión de diseño (801:550).** En "Bloquear un día", el interruptor "Todo el día" arranca encendido. El Figma lo dibuja apagado y sin "Hora de inicio", lo que es contradictorio. Hay que elegir: bloqueo siempre de jornada completa (sin interruptor) o el estado actual.
- **Decisión transversal (orquestador).** El footer compartido `<weotzi-product-footer>` aparece en el calendario y en todas las páginas del artista, pero ningún frame del Figma final lo muestra. No lo quité solo del calendario.
- La superposición de sesiones solo se valida en la vista previa local: el trigger del servidor cubre únicamente `artist_calendar_events`.
- Diferencias deliberadas con el Figma:
  - Las etiquetas de hora del Figma se desfasan de las filas; acá van alineadas.
  - La franja "Todo el día" de semana y día no está en el Figma. Aparece solo cuando hay eventos de ese tipo.
  - El formato de una línea para turnos cortos tampoco está en el Figma, que no tiene turnos de menos de una hora.
  - Las opacidades 0,35 y 0,5 del Figma usan el token `--opacity-disabled` (0,40).
- La topbar no se tocó. En los frames, el subrayado amarillo aparece bajo COTIZACIONES.

## Tests

- Calendario: `tests/calendar-figma.test.js` y `tests/figma-final-calendario.test.js`, 25/25 en verde. En la ronda 1 sumé 4 tests:
  - "+N" y agenda;
  - login canónico y sin cuenta fija;
  - franja de todo el día;
  - detalles de la auditoría.
- Suite completa (ronda 1): 553 tests, 547 pass, 5 fail, 1 skipped. Los fallos son ajenos al calendario: PowerShell 7 (3, preexistentes) y registro (2, área en curso).
- Ronda 2: calendario 27/27 en verde. Sumé 2 tests, uno para el formato de los bloques cortos (`timedEventLayout`) y otro para el link único de 801:547, y actualicé el assert de avisos visibles.
- Suite completa (ronda 2): 582 tests, 574 pass, 7 fail, 1 skipped. Los 7 fallos son ajenos al calendario: PowerShell 7 (3, preexistentes), topbar del artista en `components-catalog` (1), `figma-final-travel-inbox` (2) y `job-applications-figma` (1). Son áreas que otros agentes están editando.
