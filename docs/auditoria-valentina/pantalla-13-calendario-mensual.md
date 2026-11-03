# Pantalla 13 · Calendario mensual

## Alcance y fuente

- Referencia solicitada: [Figma 801:542](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-542), «Artista / Calendario - Vista mensual», 1440 × 1127.
- Ruta: `/calendar/`; comparación de julio mediante `?date=2026-07-07`.
- Rama: `valentina/rediseno-laura`. Base previa: `89206b75663e87bcc85c5c2d43d00ba3d31421ce`.
- Confirmación de Valentina: implementar la mensual; quedan otros cinco frames cuyos enlaces todavía no fueron enviados. No se implementan por inferencia.
- Runtime HTML/CSS/JS existente. Sin cambios en consultas, permisos, repositorios, controlador, autenticación, persistencia, otras rutas ni vistas semanal/diaria/agenda/editor.

| ID | Rol / URL / estado | Nodo de referencia | Visual | Funcional | Evidencia / acción |
| --- | --- | --- | --- | --- | --- |
| P13-01 | Artista · `/calendar/?date=2026-07-07` · mes | `801:542` | Con desvíos de datos y header documentados abajo; composición mensual ajustada | Simulado | Browser integrado, comparación con captura y medidas del nodo; búsqueda, filtros, navegación y teclado aprobados |
| P13-02 | Artista · semana / día / agenda / editor | Sin nueva referencia en esta tarea | Sin rediseño en esta entrega | Simulado | Comparación de estilos calculados con la hoja mensual activada/desactivada: idénticos en todos los elementos visibles |

## Implementación

`public/calendar/index.html` carga una hoja adicional y declara la vista mensual inicial. `public/shared/css/calendar-month.css` limita sus reglas a `data-view="month"`; los ajustes del header requieren además que el calendario mensual esté visible. Se reutilizan los tokens, las fuentes y los componentes compartidos sin modificar sus archivos.

Se ajustaron peso regular Archivo Black del titular, colores de leyenda, tipografía y separación de tabs, divisor, navegación de período, búsqueda, filas del mes, barras de eventos, opacidad de días externos, separaciones y marcadores del lateral. La leyenda se distribuye en más filas cuando no entra; el tablero permanece en siete columnas. La cabecera compacta conserva sus controles en anchos menores.

### Recursos originales

Descargados mediante las URLs de assets devueltas por `get_design_context`. No quedan URLs temporales en el runtime. Los SVG no se modificaron ni se redibujaron.

| Recurso local en `public/shared/assets/calendar-month/` | Capa / uso | Dimensiones originales y render |
| --- | --- | --- |
| `plus.svg` | `48:8099` · Nuevo evento | 18 × 18 |
| `previous.svg` | `48:8120` · Período anterior | 5.33333 × 9.33333, centrado en control de 35.2 × 35.2 |
| `next.svg` | `48:8126` · Período siguiente | 5.33333 × 9.33333, centrado en control de 35.2 × 35.2 |
| `search.svg` | `48:8129` · Buscar | 18 × 18 |

Se comprobó archivo no vacío, respuesta HTTP correcta, carga en navegador, posición de uso y `background-size` a sus dimensiones nativas. Los glifos anteriores siguen intactos en las otras vistas.

## Evidencia de navegador

Browser integrado disponible; sin fallback a Playwright. Entorno local seguro ya ejecutándose en `http://localhost:4647`, proceso `node scripts/release/local-preview.cjs`. Se confirmó `WEOTZI_PREVIEW === true`. La segunda ejecución de dev:safe encontró el puerto ocupado y no se terminó el proceso existente.

Para variar viewports se utilizó un iframe de la misma ruta y origen dentro de una pestaña de QA, con ancho real CSS ajustado; el escalado exterior solo permite mostrarlo en el panel Review y no altera su layout interno. Se revisó también la página directa. Fuentes Archivo Black, Inter y JetBrains Mono cargadas.

- Antes del ajuste: comprobación de altura de día 129.6 y SVG local del botón fallidas; después aprobadas.
- A 1440: shell x32; contenido x76 y ancho1320; hero y120, altura132.80; controles y252.80, altura78.40; leyenda y331.20, altura68; tablero x76/y407.20/ancho980/alto676.50; lateral x1096/ancho300. Diferencias subpíxel por rasterización del navegador respecto del borde 1.6 del frame.
- 1920, 1600, 1440, 1366, 1280, 1024, 768 y 390: documento sin overflow horizontal, acciones del mes dentro del viewport y header sin superposición. Se corrigieron desbordes reproducidos a 1280 y 390 solo para esta vista.
- Buscar «Tomás»: queda un evento en tablero y lateral. Buscar sin coincidencias: mantiene las 35 celdas de julio e informa el vacío lateral. Limpiar restaura eventos.
- Filtro Turno confirmado: oculta cuatro barras y cambia `aria-pressed`; segundo clic restaura.
- Siguiente: Agosto 2026. Anterior: Julio 2026.
- Enter sobre el 11 de julio abre el editor existente. Volver restaura la vista mensual.
- Semana, día, agenda y editor: estilos calculados de todos los elementos visibles idénticos con la nueva hoja habilitada o deshabilitada (display, font, color, fondo, padding, margin, gap, columnas, ancho/alto, borde, posición).
- Consola: sin errores JavaScript propios del calendario. Aviso previo `[support-chat] conversation endpoint failed 501`: soporte remoto no simulado, fuera de alcance.

Para la comparación visual con el frame se usaron 16 eventos ficticios de referencia, reemplazando `Calendar.listRange` **únicamente en memoria de la pestaña de QA**; no se cambió el adaptador, ningún archivo de fixtures, ni se guardó en Storage/Supabase. Se comprobó el resumen 4 turnos / 2 solicitudes / 2 días. Recargar elimina esa sustitución. No acredita persistencia ni comunicación reales.

Captura comparativa local (temporal, no publicada): `C:\Users\Dev\AppData\Local\Temp\opencode-browser-oOOLL3\0\screenshot.png`.

## Diferencias intencionales y límites

- El frame tiene Cotizaciones subrayado pese a ser Calendario. Se conserva `aria-current="page"` y el subrayado de Calendario del producto, en lugar de indicar una sección incorrecta.
- Se mantienen el cambio Modo cliente y los contadores dinámicos del encabezado compartido. No se esconden funciones ni notificaciones para imitar un header estático sin contadores.
- Fechas, nombres, próximos eventos y resúmenes siguen derivados de la sesión y de sus eventos. No se reemplazan datos reales por los ejemplos de julio. Por estos motivos no se declara identidad píxel a píxel de todos los estados/datos del producto con la captura estática.
- Soporte flotante y controles de preview son herramientas existentes, no capas del frame.
- Otros cinco frames pendientes de enlaces. No hay prueba de escritura remota, correo, integración ni seguridad de autenticación en esta entrega visual.

## Entrega y recuperación

La versión y la validación automatizada definitiva constan en `docs/CHANGELOG.md`. La autoentrega verifica CI del push y la misma SHA en `https://preview.weotzi.chat/api/release`; hasta entonces no se declara publicada.

Rollback: revertir el commit de esta entrega y publicar una nueva versión en la misma rama. No hay migraciones ni cambios de datos para revertir. No mezclar a main; revisión de Isaí.
