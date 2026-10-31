# Área cotizaciones-detalle · Figma final del flujo de artista

**Ruta:** `/my-quotations/detail?id=<quote_id>` (alias `?quote=`).
**Frames:** 801:576, 577, 580, 581, 582, 583 y 584 (estados) · 801:578 y 579 (notas) · 801:1111–1115 (plantillas). La fidelidad es alta en todos. Las capturas están en `output/figma-final-artista/shots/cotizaciones-detalle/<nodo>.png`. En la ronda 2 rehice las de los estados (801:576 a 801:584). Las de notas y plantillas son de la ronda 1.

## Ronda 2 · historial de 801:581 (P1)
El hallazgo se verificó con DEMO-D01 real y quedó corregido. Ahora el historial queda así:

| Fecha | Evento |
| --- | --- |
| 15 OCT | Solicitud creada |
| 15 OCT | Vista por vos |
| 16 OCT | Respuesta enviada |
| 17 OCT | Acuerdo confirmado |
| 18 OCT | Trabajo iniciado |
| 18 OCT | Sesión 1 registrada |
| 28 OCT | Sesión 2 registrada |

El timeline muestra 15, 16, 17 y 18 OCT, en el mismo orden que el Figma. Corregí cuatro cosas:

1. **Fixtures de DEMO-D01.** La sesión 1 quedaba antes de la solicitud. Les apliqué el mismo arreglo que a C01 y D03: solicitud a −13 días, respuesta a −12 y acuerdo a −11, antes de la sesión 1 (−10). No cambian el estado, los montos, las sesiones ni el orden del listado.
2. **Una sola fecha para "Trabajo iniciado" y para el paso "En progreso".** Las dos salen de `QuotationDetailModel.workStartedAt`. Toma la primera fila `in_progress` del historial. Si no la hay, usa la primera sesión realizada, como en el Figma, donde ambas caen el 12 AGO. Como último recurso, usa `updated_at`.
3. **"Trabajo iniciado" ya no desaparece.** Sigue en el historial después de "Marcar listo para cliente" y también en los estados completada y en disputa.
4. **Sesiones sin fechas futuras.** Una sesión agendada para otro día que se marca como realizada hoy se guarda con la fecha de hoy, y el diálogo lo avisa. Además, el modelo nunca fecha una sesión después de hoy ni después de su última modificación (`sessionDoneAt`). La corrección de D03 agendada para mañana ahora queda "28 OCT Sesión 3 registrada".

Capturé los flujos reales: `801-580-d01-real.png`, `801-581-d01-real.png`, `801-582-d01-listo.png` y `801-584-correccion.png`. La consola no muestra errores.

**Enlaces a otras áreas.** Todos los enlaces al calendario llevan `?quote=<quote_id>`; en esta ronda lo sumé también a "Abrir calendario →". Los probé en el preview:
- "Ver sesión" de la sesión 2 de D01 abre el editor de esa sesión con D01 vinculada.
- "Agendar" de P01 abre "Turno con cliente" con P01 ya elegida.
- "Contactar cliente" y "Ver chat completo" abren `/artist/inbox?quote=DEMO-D01`, en el hilo de D01.

**Diferencia que queda.** En 801:583 y 801:584 el historial del Figma está abreviado: no muestra "Trabajo iniciado" ni las sesiones, que sí aparecen en 801:581. El expediente muestra el registro completo para que ningún evento desaparezca al avanzar de estado.

## Ronda 1 · correcciones del auditor
- **801:583, panel "Proyecto completado":** son 5 columnas de 160px separadas cada 186px. Las etiquetas van en una sola línea, así que los 5 valores quedan alineados. Había dos reglas `.qd-closeout-grid .qd-label`; quedó una.
- **801:576/577, dossier:** ahora mide 519px (el Figma, 518).
  - El textarea mide 123px y ya no tiene el control de redimensionar.
  - El aviso de autoguardado se muestra encima del textarea y no suma alto.
  - El panel termina 14px debajo del textarea.
- **801:578, velo del panel de notas:** usa `--neutral-500` al 46%, que sobre arena da la misma luminancia que `rgba(26,26,26,.45)`.
- **801:578/579 y 801:1111–1115, filas de botones:** "Plantillas" corta 4+1 y "Agregar bloque" 5+2, como en el Figma. Lo medí también con la scrollbar clásica de Windows (15px). Las fuentes siguen en 10px, el mínimo del DS; ajusté el tracking para que cada carácter ocupe lo mismo que en el Figma.
- **801:582, estado "Lista para cliente":** quité el panel "Lista para cliente · enviada", que no está en ningún frame. Quedan la barra con "Contactar cliente" y el timeline. "Reabrir trabajo" ahora solo se abre con `?modal=reabrir`.
- **`?estado=`:** el aviso de vista previa ya no es un recuadro al pie de la página. Ahora es un toast que desaparece solo.
- **`?plantilla=`:** antes creaba una nota en cada carga. Ahora arma la nota sin guardarla y la guarda recién cuando el artista la edita. Lo verifiqué: 3 notas al cargar, 4 al editar y 4 al recargar.
- **801:584, disputa:** la sesión de corrección ya se puede reprogramar y marcar como realizada, sin cambiar `quote_status`. Al registrarla, un aviso indica que hay que responder la disputa.
- **801:581, historial:** el orden es por día y, dentro del día, por etapa. Así "Trabajo iniciado" queda antes que "Sesión N registrada". Además, el inicio del trabajo ahora se guarda antes que la sesión.
- **Fixtures de DEMO-C01 y DEMO-D03:** adelanté la solicitud, la apertura y la respuesta, y agregué fechas en `quotation_status_history`. Ahora la solicitud y el acuerdo quedan antes de la primera sesión. Siguen en el mismo grupo del listado y dentro de los 30 días de estadísticas.
- **Referencias vacías:** "sin archivo adjunto" ya no aparece subrayado.
- **Fotos sin URL firmada:** la miniatura pasa a ser un `<div>`. Mientras se resuelve la URL, el enlace no tiene `href`.
- **LOG OUT:** ahora lleva a `/artist/login`; antes llevaba a `/registerclosedbeta`.
- **Enlaces a otras áreas (verificados en el preview):**
  - "Ver sesión" abre `/calendar?date=…&event=session:<id>&quote=<quote_id>`: el editor de esa sesión.
  - "Agendar", en estado pendiente, abre `/calendar?date=…&quote=<quote_id>`: "Turno con cliente" con la cotización vinculada.
  - "Ver en el calendario →" de los toasts usa el mismo formato.
  - "Contactar cliente" y "Ver chat completo" abren `/artist/inbox?quote=<quote_id>`, y el inbox selecciona la conversación de esa cotización.

**No los corregí porque no son de esta área:**
- `<weotzi-product-footer>`: todas las páginas del artista lo usan, así que es una decisión global.
- Los badges "3" y "18" de la topbar son del área Dashboard.
- Space Grotesk en "La propuesta" depende de una decisión del DS.

## Qué quedó hecho (base)
- El estado del expediente sale de la cotización, sus sesiones y la disputa (`QuotationDetailModel.deriveStage`). Los estados son: pendiente, respondida, aprobada, en progreso, listo para cliente, entregada, completada y en disputa. Además: rechazada, vencida y borrador.
- La barra de comandos muestra solo los botones de cada frame:
  - **Aceptar:** envía el presupuesto y pasa la cotización a `responded`.
  - **Rechazar:** la pasa a `cancelled`.
  - **Agendar:** depende del estado.
    - Pendiente: abre el calendario con la cotización.
    - Respondida: abre "Confirmar acuerdo y agendar".
    - Aprobada o en progreso: agenda la próxima sesión.
  - **Marcar listo para cliente:** la pasa a `artist_completed`.
  - **Ver disputa ⌄:** responder, agendar una corrección o escribir al cliente.
  - **Contactar cliente:** abre el inbox.
- Sesiones: se pueden agendar, reprogramar y marcar como realizadas, con duración, fotos y nota. "Editá el acuerdo" también funciona.
- Cierre del proyecto: "Descargar resumen" (.txt) y "Archivar/Desarchivar".
- Las notas privadas se guardan solas. "Vista por vos" se registra la primera vez que el artista abre el expediente.
- Notas de trabajo, en un panel de 620px:
  - bloques, plantillas y etiquetas;
  - autoguardado;
  - notas anteriores, que se pueden abrir y borrar;
  - "Nueva nota" y "Exportar" (.md).

## Backend (sin aplicar)
La migración es `supabase/migrations/20261028130000_quotation_detail_figma.sql`, con su reversa en `supabase/rollbacks/`. Agrega:
- `artist_session_minutes` y `artist_viewed_at`;
- `photo_urls`;
- la tabla `quotation_disputes`, con RLS;
- el bucket `quotation-session-photos`.

Si la migración no está aplicada, el repo `quotation-detail-repo.js` degrada sin romper la página.

## Parámetros de QA
- `?estado=pendiente|respondida|aprobada|en-progreso|listo|completada|disputa`: solo en preview. Usa datos en memoria y deshabilita las acciones.
- `?panel=notas[&nota=nueva|<id>][&plantilla=brief|preparacion|seguimiento|cuidados|pendientes]`
- `?modal=responder|rechazar|acuerdo|agendar|listo|disputa|responder-disputa|correccion|reabrir`
- Cotizaciones reales del preview:
  - DEMO-P01: pendiente.
  - DEMO-S01: respondida.
  - DEMO-D01: aprobada.
  - DEMO-D03: en disputa.
  - DEMO-C01: completada.

## Pendiente o riesgos
- Ninguna pantalla del cliente ni de soporte abre disputas todavía. Severidad: media.
- Las fotos de sesión necesitan la migración y el bucket. Severidad: media.
- "Reabrir trabajo" no tiene lugar en el Figma: hoy solo funciona por URL. Severidad: baja.
- En una disputa no hay "volver a entregar": el cierre lo hace soporte. Severidad: baja.
- En una disputa, la sesión de corrección se suma como "Sesión 3 de 3" aunque el acuerdo sea de 2, y cuenta en la barra de avance. No hay frame para este caso. Severidad: baja.
- El preview no tiene el trigger que registra el historial de estados. Sin esa fila, "Trabajo iniciado" toma la fecha de la primera sesión realizada.

## Cambios de copy
- "or browse files" → "sin archivo adjunto".
- "1 BLOQUES" → "1 bloque".
- "VER chat COMPLETO" → "Ver chat completo" (se muestra en mayúsculas por CSS).

## Tests
`node --test "tests/*.test.js"` (ronda 2): 605 tests, 601 pass y 3 fail. Las 3 fallas son los tests de PowerShell 7 que ya fallaban antes.

Tests del área:
- `tests/figma-final-cotizaciones-detalle.test.js`: 19 de 19. Sumé 3 tests en la ronda 2: fecha común de historial y timeline, "Trabajo iniciado" después de la entrega, y sesiones sin fecha futura. El test de fixtures ahora cubre también DEMO-D01.
- `tests/quotation-detail-figma.test.js`: 4 de 4.
- `tests/demo-tour.test.js`: 12 de 12.
