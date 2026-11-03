# Pantalla 13 · Calendario: mes, semana y día

> Informe de la entrega `.25`. La continuación autorizada `.26` agrega exclusivamente cuatro estados de alta (801:546–549), dentro de la misma pantalla 13. Diseño, pruebas y límite de vinculación acordado: [pantalla-13-calendario-editor.md](pantalla-13-calendario-editor.md).

## Alcance vigente

Valentina pidió publicar **solo estos tres frames**, contados como una única pantalla 13:

| Vista | Referencia exacta | URL / acceso |
| --- | --- | --- |
| Mes | [801:542](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-542) | `/calendar/` · tab Mes |
| Semana | [801:544](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-544) | `/calendar/` · tab Semana |
| Día | [801:545](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-545) | `/calendar/` · tab Día |

No se implementan otros frames, Agenda ni el editor. No se modifica ninguna otra ruta. La referencia se leyó mediante `get_design_context` con capturas; la cabecera del día `52:8937` también se inspeccionó en detalle (980 × 83.2).

La mensual se entregó en `.24`, SHA `a29777a0d3d2e25fcd2348cc4ad9b88a94855f8c`, [CI aprobado](https://github.com/WeOtzi/betav1/actions/runs/41568071500), misma SHA pública comprobada. Su evidencia histórica está en [pantalla-13-calendario-mensual.md](pantalla-13-calendario-mensual.md). Esta entrega `.25` agrega semana y día, conservando la mensual.

## Implementación y aislamiento

- Se reutilizan la navegación, el footer, las fuentes y los tokens existentes. Los ajustes comunes de `calendar-month.css` se comparten explícitamente entre los tres valores `month`, `week`, `day`, sin cambiar la apariencia de Mes. El header requiere además que la vista esté visible.
- `calendar-time.css` contiene exclusivamente la geometría de semana/día, sus rótulos, grillas y bloques de eventos. Agenda y editor quedan fuera de sus selectores.
- `calendar.js` conserva sus consultas, eventos, navegación, filtros, validaciones, CRUD, permisos y formato de datos. La única modificación agrega dos variables CSS numéricas a los bloques temporizados, derivadas de los mismos porcentajes de posición y duración ya calculados. No cambia las fechas ni las duraciones de negocio.
- Los cuatro SVG son los mismos recursos exactos que la mensual. Se descargaron temporalmente los ocho assets devueltos por los dos frames nuevos y se compararon sus SHA-256 con los locales: **ocho coincidencias**. No se duplican ni se modifican sus bytes.
- Se conserva el indicador correcto Calendario, el cambio de modo y los contadores dinámicos del header, frente al subrayado Cotizaciones de la referencia estática. Los datos y el período visible siguen siendo los de la sesión; no se falsifica una agenda de julio en el runtime.

## Inventario

| ID | Estado | Visual | Funcional | Evidencia |
| --- | --- | --- | --- | --- |
| P13-M | Mes | Composición conservada; diferencias de header/datos documentadas | Simulado | Comparación completa de estilos calculados contra CSS pública `.24` en ocho anchos: idénticos |
| P13-S | Semana | Geometría ajustada al nodo; diferencias de header/datos documentadas | Simulado | Siete columnas, fecha seleccionada, horario, eventos, leyenda, lateral, captura comparable |
| P13-D | Día | Geometría ajustada al nodo; diferencias de header/datos documentadas | Simulado | Una columna, cabecera 83.2 px, horario, evento, leyenda, lateral, captura comparable |
| P13-A/E | Agenda / editor | Sin rediseño en esta tarea | Simulado | Estilos calculados idénticos contra `.24`; entrada/salida del editor conservadas |

## QA de navegador

Browser integrado, sin fallback externo. Local seguro en `http://localhost:4647`, `WEOTZI_PREVIEW === true`. Se usó un iframe del mismo origen con viewports CSS reales para cubrir 1920, 1600, 1440, 1366, 1280, 1024, 768 y 390 px. Su escala exterior solo permite visualizarlo en Review y no altera el layout interior.

### Medidas de referencia y regresiones

- Primero fallaron en semana y día las comprobaciones de peso regular Archivo Black, offset del hero, columna horaria de 56 px y SVG original. Después aprobaron.
- A 1440: hero Semana x60/y117, Día x56/y110, ambos ancho1320. Tablero semanal x60/y404.20/ancho980; horas ancho56, cabecera58.4 y cuerpo681.6. Cabecera diaria 980 × 83.2; grilla x56/y488.40, horas ancho56 y cuerpo825.6.
- Bloques semanales: Tomás top104/alto160; Bruno top312/alto111.20, borde punteado; Julieta top52/alto108. Bloque diario: top128/alto204. Los valores provienen de las fechas ficticias de comparación, no de coordenadas por nombre de cliente.
- La captura detectó el centrado vertical nativo de los botones de evento: texto a 93.5 px del borde en Día en vez de al comienzo. La comprobación falló; se corrigió con layout flex column/start exclusivo de los eventos temporizados. Después, título a 16 px en Semana y al comienzo del bloque diario, como la referencia.
- Mes: estilos de todos los elementos visibles idénticos a la CSS pública `.24` en los ocho anchos. Un falso positivo a 1024 se aisló al color interpolado de hover del botón Nuevo evento; al desactivar transiciones únicamente en la prueba, las ocho comparaciones aprobaron. No se cambió el hover del producto.
- Agenda/editor: mismo control contra `.24`, sin diferencias calculadas de display, fuente, color, fondo, padding, margin, gap, columnas, dimensiones, borde y posición.
- Semana/día: 16 combinaciones de vista/ancho sin overflow horizontal ni botones/campos fuera del viewport; siete/una columnas conservadas y etiqueta de período dentro de las flechas.

El Figma utiliza escalas ligeramente distintas para rótulos horarios, líneas horizontales y bloques. Se conserva esa geometría literal en desktop; las fechas de los eventos no se alteran para compensarla. El rango horario y la exclusión de eventos todo-el-día de las grillas son el comportamiento previo del controlador.

### Interacciones

En ambas vistas:

- Buscar Tomás deja un bloque; búsqueda sin coincidencias deja la grilla vacía y el mensaje lateral; limpiar recupera eventos.
- Filtro Turno confirmado oculta sus bloques y actualiza `aria-pressed`; segundo clic restaura.
- Siguiente cambia de semana/día; Anterior vuelve al período original.
- Clic en sesión proyectada conserva el aviso de administración desde Cotizaciones; no habilita una escritura incorrecta sobre una proyección.
- Nuevo evento abre el editor existente y Volver recupera la vista. También se probaron ambos botones con Enter real mediante Browser.press.
- El tab seleccionado conserva `aria-selected` y el foco visible con el anillo compartido (box-shadow azul de 3 px).
- Sin errores JavaScript de calendario en la consola. Soporte 501 sigue siendo una limitación previa del entorno seguro.

Para comparar contra julio se cargaron 16 eventos ficticios **solo en memoria de una pestaña QA**, reemplazando temporalmente `Calendar.listRange`; se recarga la pestaña para eliminarlos. No se modificó el adaptador, ningún fixture persistente, Storage, datos reales ni Supabase. Las pruebas no acreditan escritura, autenticación, correos ni integraciones reales.

### Capturas locales temporales

- Semana final: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-AKC0Rg\0\screenshot.png`.
- Día final, texto corregido: `C:\Users\Dev\AppData\Local\Temp\opencode-browser-tOkd7Y\0\screenshot.png`.
- Mes: captura enlazada en su informe histórico `.24`.

## Validación y publicación

- `node --check public/shared/js/calendar.js`: aprobado.
- `node --test tests/calendar-figma.test.js`: 10/10.
- Suite completa y política de entrega: ver resultado definitivo en `docs/CHANGELOG.md` y la herramienta de autoentrega.
- Se publica exclusivamente `valentina/rediseno-laura`. El comando de autoentrega debe aprobar CI del evento push y comprobar la misma SHA y versión en `https://preview.weotzi.chat/api/release` antes de declarar éxito.
- Página de revisión: `https://preview.weotzi.chat/calendar/`; cambiar Mes / Semana / Día. Para comparar julio, agregar `?date=2026-07-07`. El contenido dinámico puede diferir de la captura, intencionalmente.
- PR permanente: https://github.com/WeOtzi/betav1/pull/12 . No se mezcla a main.

Rollback: revertir el commit de `.25` y publicar una nueva versión para volver al calendario de `.24`. Para retirar también la mensual, revertir además `a29777a` mediante una entrega revisada. No hay migraciones ni datos que revertir. El rollback operativo corresponde a Isaí.
