# Pantalla 12 — dashboard del artista

## Estado: principal publicado; estados adicionales implementados

- Rama: `valentina/rediseno-laura`.
- Base comprobada: `ab9ff81502f6ca6aa81aec5204047bb10f8eebcc`.
- Referencia: https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=24-1425
- Nodo: `24:1425`, Artista / Dashboard - Contenido principal, 1441 × 2592.
- Local seguro: http://localhost:4647/preview/preview-local-safe/artist/dashboard/
- Destino solicitado: https://preview.weotzi.chat/artist/dashboard/
- Versión preparada: `2.2.3-valentina.rediseno-laura.22`.
- Valentina pidió explícitamente publicar este avance después de ser informada
  de la comparación visual pendiente. Indicó que quedan otros dos frames del
  dashboard dentro de la pantalla 12; sus enlaces todavía no se recibieron.
- Al publicar `.22` no se consideró completada la fidelidad visual ni esos dos estados adicionales.

Actualización: el principal `.22` se publicó con SHA
`d8e1fbe65cedc29c8bc39e77ddc9c0eef4e090d9`, CI aprobado
https://github.com/WeOtzi/betav1/actions/runs/41563326089 y misma SHA pública.
Luego se recibieron los nodos `801:559` y `801:558`, se implementaron y se pudo
capturar desde el navegador integrado. La evidencia, pruebas y diferencias del
fondo se detallan en [pantalla-12/design-qa.md](pantalla-12/design-qa.md).
El bloqueo de captura descrito más abajo es histórico; no se aplica a esta
segunda entrega. Nuevo recordatorio continúa pendiente de definición funcional.

| Estado | Visual | Funcional | Evidencia / límite |
| --- | --- | --- | --- |
| Dashboard principal | Con desvíos; comparación final pendiente | Simulado | Contexto y captura exactos de Figma leídos; layout local medido en navegador |
| Agenda, diseños, estadísticas, ingresos, actividad, recordatorios | Comparación final pendiente | Simulado | Referencia de Laura limitada por doble guardia a esta página de preview |
| Abrir/cerrar QR | Comparación del modal fuera del alcance visual | Probado en preview | El botón visible abre el modal existente y el cierre elimina su estado activo |
| Nuevo recordatorio | Control presente | Bloqueado | No existe handler de alta en el producto ni definición del flujo en el frame. Informa indisponibilidad; no guarda ni simula éxito |
| Escritorio / responsive | Comparación final pendiente | Medición DOM probada | Iframe same-origin con viewport real de 1441, 1920, 1280, 1024, 768 y 390 px; sin overflow ni controles fuera del ancho después del ajuste |

## Alcance y contratos

Se reutilizan la navegación y el footer compartidos, los tokens, Archivo Black,
Inter, JetBrains Mono y los iconos Feather locales del producto. La hoja nueva
se carga exclusivamente desde `public/artist/dashboard/index.html` y está
limitada por `.artist-dashboard-page`. `dashboard-redesign.js` solo lo consume
esa pantalla. No se editan componentes compartidos, otras páginas, repositorios,
autenticación, permisos, seeds ni migraciones.

Los valores de Laura son una capa de presentación sin escrituras, activa solo
con `WEOTZI_PREVIEW === true` y `WeotziPreview.isSimulated`. La galería conserva
sus handlers originales; en preview superpone los placeholders y el ejemplo
38 % del Figma, que **no acredita una subida real**. Los destinos del perfil,
compartir, QR y nuevo cliente conservan la identidad ficticia autenticada, no
usan el nombre de Laura como propietario real. Fuera de preview se conservan
las consultas y datos dinámicos existentes.

## Validación realizada

- `node --test tests/artist-dashboard-reference.test.js tests/dashboard-figma.test.js`: 6/6.
- `npm test`: 450/450 aprobadas.
- Navegador integrado disponible. Página identificada como dashboard, con
  contenido y doble marca de preview comprobada.
- Medición responsive mediante iframe temporal, sin alterar archivos de producto.
  Las barras de scroll dejan 15 px menos de ancho de contenido en viewports
  pequeños; se verificó el ancho de contenido efectivo, no solo el nominal.
- QR: apertura desde el control visible y cierre comprobados por estado DOM.
- Consola: bloqueo CSP preexistente de un worker `blob:` de `heic2any` en el
  entorno seguro. No se cambia la política ni se declara probada conversión HEIC.

## Bloqueo y pendiente

`browser.screenshot` falló con: “Screenshot needs a visible tab. Call
browser.tabs.focus and keep its desktop window visible”, incluso después de
enfocar la pestaña. Se solicitó mantener visible la ventana de OpenCode con el
panel de preview. No se recurrió a otro navegador ni se declaró fidelidad visual
sin capturas. La captura fuente se descargó solo al directorio temporal aprobado.

Pendiente visual: comparar y ajustar la captura renderizada frente al frame
completo, verificar cada asset y los estados interactivos restantes y resolver
cualquier desvío. El usuario autorizó publicar sin cerrar ese pendiente.

La publicación se ejecuta con la herramienta de autoentrega: repite pruebas y
`check:release`, registra commit y push, y comprueba CI y la misma versión/SHA
en `/api/release`. El resultado de esa ejecución se comunica al cierre.

## Recuperación

No hay modificaciones de datos. Conservar el trabajo para completar la
verificación; no usar reset ni restauraciones generales. Para deshacer la
publicación, revertir únicamente su commit mediante una nueva entrega versionada.
El rollback operativo corresponde a Isaí.
