# Pantalla [8] · Revisá tu publicación

- Referencia: [We Otzi Pantallas final · 801:1131](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1131).
- Sistema de diseño: `jLxPQyG2rxrq5bvfQgNcBd`, búsqueda de stepper y surface-page; sin componente de stepper equivalente. Se reutilizan tokens, organismo `weotzi-product-nav`, botones y estructura del wizard existentes.
- Entorno: Windows Dev, rama `valentina/rediseno-laura`, versión `2.2.3-valentina.rediseno-laura.16`.
- Local: `http://localhost:4647/preview/preview-local-safe/job-board/request/`, `WEOTZI_PREVIEW === true`, fixtures y backend aislados.
- Publicación solicitada: https://preview.weotzi.chat/job-board/request/ (crear idea → completar formulario → continuar a revisión).

## Inventario

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P8 | Cliente /job-board/request/ · review | No aportado para esta tarea | 801:1131 | Con desvíos de contenido por contrato vigente; composición contrastada | Simulado: navegación y borrador local; envío bloqueado en entorno local | revision-1440.png, revision-390.png | CSS local al estado review y SVG originales |

## Cambios y comparación

- Referencia leída con `get_design_context` y captura natural 1440×1122. Tarjeta verificada en el render a x=89, y=385.97, ancho=1260 y alto=584.97, frente a x=89, y=386, ancho=1260 y alto=584.98 en Figma.
- Tipografías Archivo Black, Inter y JetBrains Mono locales ya presentes; colores desde los tokens. Header compartido y stepper ajustados únicamente bajo `jbrq-is-review`.
- Se quita el título derivado adicional que Figma no muestra. Se mantienen descripción y ocho campos dinámicos, así como las opciones adicionales cuando el cliente las eligió.
- Cuatro SVG descargados de la respuesta de Figma en `public/shared/assets/job-board-review/`: volver 14×14, editar 18×18, avanzar 18×18 y referencia 28×29.1. Archivos no vacíos, dimensiones y seis callsites visibles comprobados. Las referencias subidas siguen siendo imágenes del usuario; los slots restantes muestran el placeholder original.
- Las referencias vacías muestran el texto literal de Figma; no se inventa una nueva acción de carga desde revisión. Para cambiar archivos se usa Editar, como en el flujo existente.
- El ojo flotante de PREVIEW es un control del entorno seguro, no parte del diseño. No se modifica ni se oculta.

## Pruebas

- `npm test`: 441/441; nuevas regresiones de activación/desactivación del scope, navegación, datos escapados, slots vacíos y referencia subida.
- `npm run check:release`: aprobado.
- Browser integrado: identidad de ruta, estado review, contenido y captura completa; sin pantalla de error ni vista vacía.
- Edge/Playwright existente, sin instalar dependencias: complemento para viewports precisos porque Browser no expone resize y no hay skill browser en esta sesión. Anchos 1440, 1920, 1280, 1024, 768 y 390, alto 1122; sin desbordamiento horizontal, assets visibles completos y sin excepciones JS.
- Recorrido real de UI: Crear mi idea → descripción / estilo Blackwork / tamaño / Espalda / blanco y negro / presupuesto / ciudad → continuar → revisión → Editar → datos conservados → revisión → Publicar → aviso de servicio no disponible → recargar → Continuar borrador → revisión conservada.
- Capturas: [desktop](revision-1440.png), [móvil](revision-390.png). Son ejemplos ficticios ingresados en el formulario, no datos reales ni reemplazos del runtime.

## Límites y discrepancias preexistentes

1. Figma muestra `Mediano (10–15 cm)`, pero `mediano` en el formulario/contrato vigente corresponde a 5–15 cm. No se cambia ese significado desde una capa visual. Igual que en pantalla 7, requiere definición de producto antes de cambiar el contrato.
2. La fecha libre de Figma (`Últimas dos semanas de septiembre`) no corresponde al selector actual de fecha concreta + flexibilidad. Se muestra la fecha elegida realmente o `A definir`, sin inventarla. La moneda se conserva explícita en el presupuesto para no confundir USD/ARS/etc.
3. El entorno local inicializa este controlador con cliente Supabase no disponible: Publicar muestra `Servicio no disponible. Recargá la página.`. No se cambia ConfigManager, Auth ni la infraestructura de previews dentro de esta tarea visual. No hay evidencia de envío, persistencia remota ni emails.
4. Consola previa al cambio: worker HEIC bloqueado por CSP `worker-src 'none'`, avisos Supabase/config no disponible y soporte 501 no simulado. No son errores de los nuevos assets ni se corrigen fuera de alcance.

## Alcance y recuperación

No se cambia código compartido de navegación/tokens ni otras rutas. La capa visual nueva está completamente prefijada por `jbrq-is-review`, y se desactiva al volver al formulario, inspiración o cuenta. Sin migraciones ni cambios de datos. Revertir el commit de esta entrega mediante nueva entrega versionada; Isaí administra el rollback operativo. La SHA y CI de publicación se informan al cerrar la tarea.
