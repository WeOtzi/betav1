# Pantalla [6] — Construí tu idea

- Fecha: 29/10/2026. Versión: `2.2.3-valentina.rediseno-laura.14`.
- Rama: `valentina/rediseno-laura`, sin crear ramas ni integrar a main.
- Fuente solicitada: [frame 801:1129](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1129), 1440 × 1619.
- Sistema de diseño: `jLxPQyG2rxrq5bvfQgNcBd`; búsqueda del encabezado y contraste con `public/shared/css/ds/` y el organismo `weotzi-product-nav`.
- URL: [preview /job-board/request/](https://preview.weotzi.chat/job-board/request/).
- Prueba local segura: `http://localhost:4647/preview/preview-local-safe/job-board/request/`, `WEOTZI_PREVIEW === true`.
- Valentina confirmó copiar literalmente los espacios grises «or browse files» y el menú de artista, pese al nombre de pantalla de cliente. No cambia el rol ni los permisos de la identidad.

## Inventario

| ID | Rol / URL / estado | Nodo auditoría | Nodo rediseño | Visual | Funcional | Evidencia | Acción |
| --- | --- | --- | --- | --- | --- | --- | --- |
| V-006 | Cliente /job-board/request/ · inspiración inicial | No solicitado | 801:1129 | Coincide | Simulado | [QA y capturas](pantalla-6/design-qa.md) | Capa aislada de inspiración |
| V-006-F | Misma vista · filtro y búsqueda | No solicitado | Derivado de los controles de 801:1129 | Coincide | Probado | 15 espacios iniciales, 5 Blackwork, búsqueda sin resultados | Corregir render antes del montaje |
| V-006-U | Misma vista · browse files / Crear mi idea | No solicitado | 801:1129 | Coincide | Probado | PNG local seleccionado, un archivo retenido al entrar al formulario | Reutilizar validación y carga existentes |
| V-006-AI | Misma vista · generar referencia | No solicitado | 801:1129, sin frame de resultado solicitado | Falta referencia | Bloqueado | Prompt vacío muestra validación; prompt válido muestra error y permite reintentar | La API de Gemini no está simulada |

## Alcance y contratos

Solo cambian el HTML de esta ruta, su controlador y una hoja CSS nueva que depende de `body.jbrq-is-inspiration`. El encabezado de cliente y las medidas originales se restauran al avanzar o reanudar un borrador. Los archivos compartidos del DS no se editan.

Se conservan `WeotziData.Artists.listPublic`, las imágenes públicas dinámicas, selección de hasta tres referencias, `weotzi_job_board_draft`, las validaciones de archivos y el wizard de publicación. Los quince placeholders se muestran únicamente cuando la fuente de galería no aporta imágenes. No se inventan artistas ni URLs; los botones abren el selector de archivos local. No se añaden columnas, permisos, seeds ni migraciones.

## Recuperación

Revertir el commit de esta entrega mediante una nueva entrega versionada. Estado previo: `4ff0b311c689529cde88ea46017e29c243081354`, versión `.13`. No hay modificaciones de base de datos que revertir. Isaí controla cualquier rollback operativo.
