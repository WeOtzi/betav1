# Pantalla 1 — Inicio, frame 797:269

Versión: `2.2.3-valentina.rediseno-laura.5`. Rama: `valentina/rediseno-laura`.

## Referencias y alcance

- Referencia exacta: https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=797-269
- Nodo leído mediante `get_design_context`, con screenshot, en sesión `cf5b981a-684a-48d4-9cc1-0939788239e5`.
- Sistema de diseño: `jLxPQyG2rxrq5bvfQgNcBd`; búsqueda de componentes y superficies. Se reutilizan tokens, marca, botones e iconos Feather del runtime, sin alterar archivos compartidos.
- Ruta local: http://localhost:4647/preview/preview-local-safe/inicio/
- Preview de entrega: https://preview.weotzi.chat/inicio/
- Entorno seguro identificado en el árbol accesible como **Entorno de prueba**, con controles flotantes de preview. Sin Supabase, correos ni integraciones reales.
- El usuario confirmó selección inicial Artista y navegación mediante CONTINUAR. No se modifican pantallas de destino.

## Inventario

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INI-01 | Público /inicio/ · Artista seleccionado | No requerido en esta tarea | 797:269 | Coincide en composición revisada, con excepción de ilustraciones pedida por usuario | Probado | Medidas, captura desktop y navegación | Implementado |
| INI-02 | Público /inicio/ · Cliente seleccionado | No requerido | Mismo frame; selección alternativa aprobada | Coincide con el tratamiento de selección del frame | Probado | Clic cambia tarjeta y destino sin salir de Inicio | Implementado |
| INI-03 | Público /inicio/ · responsive | No requerido | Composición desktop adaptada | Coincide con la composición desktop; móvil sin referencia específica | Probado | Render a 1920/1440/1280/1024/768/390 px | Implementado |

## Comparación y excepciones

- Antes: tarjetas cuadradas con enlaces directos, sin selección ni botón común; cabecera, tipografía y espacios diferentes.
- Después: cabecera de 72 px, título 38 px, tarjetas redondeadas de 20 px, borde arena/azul, fondo seleccionado y sombra dura de 3 px. Estas excepciones al DS quedan exclusivamente en `/inicio/inicio.css`.
- A 1440 px sin scrollbar interno: tarjetas en x=160/738, y≈319/316, anchos 514/504 y alturas 670/673. Botón de 180,66 × 52 px en y≈1028,28. Se mantienen las pequeñas asimetrías del frame.
- Se conservan las seis figuras CSS de las ilustraciones actuales y sus colores. No se agregan textos, iconos ni bordes de los placeholders editoriales.
- Los vectores de interfaz del frame corresponden a Feather, ya usado por `wo-icons.js`. Se reutilizan search, grid, calendar, image, inbox, bar-chart-2, check y arrow-right. La fila Solicitar cotizaciones no tiene icono en este frame.
- No es una comparación automatizada píxel a píxel; la fidelidad se revisó con screenshot y geometría renderizada. Antialiasing, métricas y zoom del navegador pueden producir diferencias subpíxel.

## Pruebas

Flujo: Inicio → elegir Cliente/Artista → CONTINUAR → destino existente de la opción.

- Tres pruebas nuevas de sincronización de destino: estado inicial Artista, cambio a Cliente y regreso a Artista. Se ejecutaron primero en rojo y luego en verde.
- `npm test`: 419 aprobadas, ninguna fallida ni omitida.
- Browser MCP: identidad/título correctos, contenido visible, sin overlay de error y sin warnings/errores de consola en Inicio.
- Clic en Cliente conserva Inicio y cambia href a `/marketplace/`; clic en CONTINUAR abre el marketplace en la preview local.
- Flecha derecha cambia de Cliente a Artista, conserva foco visible y actualiza el destino; CONTINUAR abre `/artist/login/` en la preview local.
- Responsive mediante iframes del mismo origen con anchos reales 1920, 1440, 1280, 1024, 768 y 390 px. Sin scroll horizontal, CTA cortados ni figuras ausentes. Dos columnas en escritorio/tablet y una en móvil.
- Capturas finales del navegador fuera del repositorio: desktop `opencode-browser-rI9a9F/0/screenshot.png`; móvil `opencode-browser-hCTROl/0/screenshot.png`, bajo el temporal del usuario Dev.

## Límites y recuperación

No se prueban autenticación real, persistencia de perfil ni operaciones del marketplace: esta tarea cambia únicamente el selector público. La selección es local a esta pantalla y no escribe preferencias de cuenta. No hay migraciones ni cambios de permisos.

La publicación se comprueba con CI y `/api/release` para la SHA de entrega; no se considera publicada por el solo commit. Para revertir: `git revert <SHA de esta entrega>` y una nueva entrega versionada en la rama permanente. Isaí administra el rollback operativo.
