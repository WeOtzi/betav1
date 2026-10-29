# Pantalla 7 · Describir y editar tu idea

- Referencia: [Figma final, 801:1128](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1128).
- Sistema de diseño: `jLxPQyG2rxrq5bvfQgNcBd`; búsqueda de biblioteca y lectura de tokens/componentes locales. El organismo de navegación existente se reutiliza sin modificar su implementación compartida.
- Ruta: `/job-board/request/` → **Crear mi idea** → formulario. Runtime HTML/CSS/JavaScript conservado.
- Versión: `2.2.3-valentina.rediseno-laura.15`, rama `valentina/rediseno-laura`.
- Entorno: `http://localhost:4647/preview/preview-local-safe/job-board/request/`, `WEOTZI_PREVIEW === true`. Preview pública esperada en la misma ruta desde la raíz; la SHA se comprueba al entregar, no se presume publicada por este documento.

| ID | Rol / URL / estado | Nodo rediseño | Visual | Funcional | Evidencia |
| --- | --- | --- | --- | --- | --- |
| P7-01 | Cliente · formulario · datos/selección | `801:1128` | Con desvíos acotados al contrato descrito abajo | Simulado | Captura y geometría de Chromium a 1440; assets y fuentes locales |
| P7-02 | Mismo formulario · vacío, validaciones y borrador | mismo nodo; no hay variante de error en el alcance | Coincide en composición; mensajes existentes conservados | Probado local | Descripción vacía, zona/tamaño requeridos, rango de presupuesto inválido, recarga/restauración |
| P7-03 | Formulario · 1920/1280/1024/768/390 | adaptación del frame desktop | Coincide en jerarquía adaptada | Probado local | Sin overflow ni controles recortados; menú móvil/Escape y selección |
| P7-04 | Guardado remoto, notificaciones y publicación de una solicitud | fuera del cambio visual | Falta referencia de estos estados | No probado | No se escribieron datos remotos ni se enviaron correos |

## Cambio y límites de aislamiento

- Nueva hoja `public/shared/css/job-board-form-figma.css`, activa solo con `body.jbrq-is-form`. Fuentes Archivo Black, Inter y JetBrains Mono locales. Nueve SVG originales descargados a `public/shared/assets/job-board-form/`; no hay URLs temporales de Figma en el runtime.
- Se conservan `formData`, enums, `weotzi_job_board_draft`, validaciones, handlers y envío existente. No se agregaron datos de ejemplo al runtime. El texto del lobo, Barcelona y julio se usa únicamente en el navegador QA aislado.
- Corrección reproducida: calendario, referencias y listeners se buscaban por ID antes del montaje del formulario. Ahora se inicializan después de `appendChild`. Se filtran configuraciones de zonas sin nombre antes de usar el fallback ya existente; las zonas válidas no se reemplazan.
- Estilo compacto desplegable mantiene multiselección y devuelve foco al resumen con Escape. Carga por teclado, PNG local/quitar y Continuar → revisión comprobados.
- No se alteran inspiración (pantalla 6), revisión, auth, componentes compartidos, API, esquema ni permisos. Los cambios de pantalla 6 ya se encontraban registrados en `3284df7` al cerrar esta tarea; el diff de entrega se revisa contra ese HEAD.

## Diferencias deliberadas con Figma: no anunciar identidad absoluta

1. Figma promete **PNG, JPG, PDF · máx. 10 MB**. El contrato vigente procesa **JPG/PNG/WebP y HEIC convertido, máximo 5 MB tras compresión**. La ayuda muestra el contrato real; no se añadió soporte PDF ni se cambió Storage para un ajuste visual.
2. Figma dice **Mediano (10–15 cm)**; el enum `mediano` existente se presenta y revisa como **Mediano (5 – 15 cm)**. Se mantiene el rango para no redefinir silenciosamente solicitudes existentes ni cambiar la pantalla de revisión.
3. Las opciones existentes de moneda, primer tatuaje, cover-up y fechas flexibles siguen disponibles en **Opciones adicionales**, junto al pie del formulario, aunque ese control no figura en el frame. El contador de descripción aparece al enfocar el campo. Se conserva la posibilidad de redimensionar el textarea.
4. El calendario usa la fecha real del dispositivo y deshabilita el pasado. Para comparar la referencia de julio se fijó el reloj exclusivamente en QA a 01/07/2026; no se congeló la aplicación en un mes pasado. La selección/color y todos los campos reflejan el borrador real del usuario, no valores precargados para imitar la captura.
5. El ojo flotante pertenece al entorno seguro y no al diseño. Soporte flotante/cambio de modo extra del header se ocultan únicamente en este estado, como ya ocurre en la pantalla 6; no se modifican sus implementaciones globales.

## Evidencia y pruebas

- `npm test`: **438/438 aprobadas**. Seis pruebas nuevas: montaje inicial, listeners/draft, aislamiento al salir, multiselección, zonas incompletas y Escape/foco. Los fallos de montaje, listeners, resumen y Escape se comprobaron antes de sus correcciones.
- Browser integrado: lectura del DOM, renderizado y medidas en frame aislado de 1440, más 1920/1280/1024/768/390. Se usó Chromium/Playwright instalado para las capturas de viewport real porque Browser no ofrece redimensionamiento de viewport.
- Chromium/Playwright: **1920, 1440, 1280, 1024, 768 y 390 px**, alto de viewport 1024. Sin scroll horizontal ni controles recortados; sin excepciones JavaScript.
- Interacciones: descripción requerida/foco, zona y tamaño requeridos, mínimo mayor al máximo, estilo/Escape, zona, color, fecha, menú móvil/Escape, moneda EUR y flags en borrador, recarga/restauración, carga y eliminación de PNG, avance a revisión y restauración del chrome original.
- Geometría real a 1440: título `(123, 318.97)`; textarea `(123,449.38)`, `1178×147.19`; calendario `(123,1291.47)`, `350×325`; regla de interpretación `y=1946.02`; Continuar `y=2049.81`, alto `37`. Referencia: título `(123,319)`, textarea `1178×147.2`, calendario `(122,1290)`, interpretación `y=1946`, Continuar `y=2049.17`.
- Cada asset local fue comprobado no vacío, cargado y en su slot; medidas de raíz SVG respetadas. Los checks de zonas no seleccionadas están ocultos intencionalmente. Las tarjetas de cuerpo de Figma están vacías: no se inventaron ilustraciones.
- Evidencia local sin datos personales: `C:/Users/Dev/AppData/Local/Temp/opencode/pantalla7-{1920,1440,1280,1024,768,390}.png`, `pantalla7-header.png`, `pantalla7-qa-results.json`, `pantalla7-qa.cjs`. No se incluyen capturas o scripts temporales en el runtime.
- Advertencias de preview registradas: worker de compresión bloqueado por CSP (la carga cae al procesamiento disponible y funciona), Supabase/galería no conectados y soporte HTTP 501. No son evidencia de integraciones reales; hay también un 404 de recurso accesorio que se revisa en la comprobación pública. No hubo imágenes estáticas de esta pantalla sin cargar.

## Recuperación

Revertir exclusivamente el commit de esta entrega con una nueva versión y CI en la rama permanente. No requiere migraciones ni reversión de datos. El rollback operativo del servidor corresponde a Isaí.
