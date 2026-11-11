# Pantalla 16 · Detalle de solicitud y envío de propuesta

- Referencia: [Figma 801:1068](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1068), get_design_context con captura y get_screenshot a 1440×1715.
- Versión: `2.2.3-valentina.rediseno-laura.30`; rama `valentina/rediseno-laura`.
- Preview: <https://preview.weotzi.chat/job-board/?solicitud=JB-24872>.
- Entorno local de Dev existente: `http://localhost:4647/preview/preview-local-safe/job-board/?solicitud=JB-24872`, WEOTZI_PREVIEW=true y controles de entorno de prueba comprobados. No se inicia otro servidor ni se usan credenciales de terceros.

## Inventario

| ID | Rol / URL / estado | Referencia | Visual | Funcional | Evidencia |
| --- | --- | --- | --- | --- | --- |
| P16-01 | Artista · detalle de solicitud | 801:1068 | Coincide en composición, textos de muestra y recursos | Simulado | Comparación con captura Figma y geometría del DOM a 1440 |
| P16-02 | Formulario vacío / mensaje corto | Misma pantalla | Coincide con controles del frame y foco del DS | Simulado | Vacío enfoca precio; menos de 10 caracteres muestra error y vuelve a habilitar el botón |
| P16-03 | Completar y enviar | Misma pantalla; confirmación fuera del rediseño | Coincide en formulario | Simulado | Precio 450, tiempo 1 día, 1 sesión, disponibilidad y mensaje; confirmación con precio 450 |
| P16-04 | Fallo de escritura | Estado funcional existente | Coincide con aviso existente | Simulado | Error controlado: aviso, formulario/datos conservados, botón habilitado para reintentar |
| P16-05 | Volver al listado / confirmación | Fuera del rediseño | Sin rediseño | Simulado | Se retira jbf-is-detail; listado mantiene jbf-is-feed, confirmación jbf-is-sent |

## Alcance y contratos conservados

Solo se editan el HTML de `/job-board/`, sus funciones de render de detalle y la restauración visual del botón. Se agrega una hoja CSS de estado, un adaptador visual de preview y sus SVG/tests. No se modifican otras páginas, el feed, la confirmación, los componentes compartidos, tokens globales, servidor, repositorios, autenticación, RLS ni migraciones.

`showView` activa `jbf-is-detail` solo en detalle. Encabezado compartido reutilizado sin duplicarlo; subrayado de Cotizaciones y ausencia de contadores extra respetan el frame. Footer y soporte flotante se ocultan únicamente en este estado, ya que no aparecen en el frame. Los controles flotantes del entorno seguro permanecen por política del proyecto.

Flujo trazado: tarjeta/query `solicitud` → `openRequestDetail` → `buildDetailMain` / `buildProposalAside` → `application-form` → `submitApplication` → `WeotziData.from('job_board_applications')`. Se conservan el cliente autenticado singleton, `selectedRequest.id`, `artistData.user_id`, mensaje/precio/duración/sesiones/disponibilidad y estado pending, tratamiento de errores, evento existente y confirmación. La prueba no acredita entrega real del evento ni email.

Los adjuntos reales siguen siendo imágenes dinámicas enlazadas al archivo original, ordenadas por sort_order, sin permitir al artista subir o reemplazar referencias de otra persona. El texto `browse files` reproduce el placeholder del diseño: no inventa una función de carga. Sin imagen, ampliar permanece deshabilitado. El portfolio de producción conserva imágenes, nombre, ciudad, estilos y estadísticas del artista autenticado.

## Composición y recursos

- A 1440: contenido desde x=107, título y aside desde y≈164. Columna principal 756, separación 94, aside x=957 y ancho 380.
- Referencias desde y≈415, dos columnas con separación 12 y separación vertical 92. Descripción desde y≈1041,5; formulario con controles de 44 y envío de 52.
- Archivo Black 400, Inter 400/600/700 y JetBrains Mono; rampas del DS existente. Literal gris del placeholder limitado a una variable de esta página.
- 24 SVG descargados sin alterar desde los assets del nodo en `public/shared/assets/figma/job-board-screen16/`. Flecha 14, aviso/calendario/chevron/envío 18, imagen 28×29,1; fragmentos de zoom, ubicación, reloj, verificación, estrella y usuarios conservan sus dimensiones raíz y posiciones del frame. No hay URLs temporales de Figma en runtime ni fotos inventadas.
- Comprobación de archivos no vacíos, callsites, carga sin errores y geometría efectiva. Las 23 imágenes SVG de contenido se renderizan; chevron es el recurso local de fondo de los dos selects.

## Muestra aislada y límites

`job-board-screen16-preview.js` devuelve una copia solo con WEOTZI_PREVIEW=true y display_code JB-24872, al abrir el detalle. No modifica la solicitud fuente, el feed, identidades globales ni fixtures de otras pantallas. Presenta Camila R., Lauumarth.wo, descripción y requisitos literales, tamaño y estadísticas de Figma. El ID seleccionado para enviar permanece intacto.

La fecha literal de cierre del ejemplo es 28 de julio, tal como en Figma; el contador de tres días es una muestra visual, no una fecha vigente de negocio. Los requisitos libres del frame no existen como columna del contrato actual: en producción se conservan los hechos derivados existentes, sin inventar información ni cambiar el esquema.

No se acredita persistencia en Supabase, autenticación real, emails ni integraciones externas. La nota sobre editar antes de lectura conserva el texto del frame y del runtime previo; no se implementa una nueva pantalla de edición.

## Validación

1. Cuatro tests Node/VM nuevos primero fallidos y luego aprobados: aislamiento del estado visual, referencias reales/placeholder sin uploads, utilidad antes de ambas columnas con identidad conservada, adaptador de muestra inactivo fuera de preview y sin mutar su fuente. Suite completa: 473/473.
2. Browser integrado disponible. Se usaron pestañas reales y, para anchos exactos, un iframe de la misma ruta/origen creado únicamente en una pestaña de QA, sin archivos de prueba en runtime ni cambiar la seguridad del navegador. Viewports internos 1920, 1440, 1366, 1280, 1024, 768 y 390: scrollWidth coincide con el ancho, sin controles fuera del viewport ni imágenes rotas. Capturas completas a 1440/1024/390.
3. Comparación de la captura 1440×1715 con Figma. Correcciones de geometría, espaciados, placeholders y dimensiones nativas de los fragmentos SVG. Coincidencia visual no significa igualdad byte a byte entre la rasterización de Figma y Chromium.
4. Formulario vacío enfoca precio y bloquea el envío. Mensaje corto muestra validación de diez caracteres y rehabilita el botón. Completar los cinco campos permite envío y confirmación del precio, solo en simulación. Fallo de escritura inyectado temporalmente en la pestaña conserva datos y permite reintentar; se restaura el adaptador y se recarga después.
5. Teclado: Tab pasa de precio a tiempo estimado. Se detectó y corrigió el override que suprimía borde/ring del DS: prueba del DOM primero fallida y luego aprobada con borde azul y shadow-focus. Menú compartido abre y cierra con Escape. Volver retira el estado de detalle y restaura el feed.
6. Identidad de página, contenido no vacío y ausencia de overlays comprobados. Cero errores de consola en recorrido normal; el error inducido de escritura se identifica como prueba controlada, no como fallo espontáneo.

Evidencia local sin datos privados: `C:/Users/Dev/AppData/Local/Temp/opencode/pantalla16-figma.png`, `pantalla16-1440.png`, `pantalla16-1024.png` y `pantalla16-390.png`. La captura móvil se recorta al viewport interno de 390 sin escalar ni alterar el contenido. La comparación desktop se muestra en Review.

## Publicación y recuperación

Autoentrega verifica Verify delivery del push y la misma SHA/versión pública en `/api/release`; el cierre informa los identificadores comprobados. PR de la rama permanente para revisión de Isaí, sin mezclar a main.

Revertir este commit con nueva entrega versionada recupera `.29` (`9803bfd12c2e12caa58c9c8a61a2b6fba37ff7fe`). No hay migraciones ni datos remotos que revertir.
