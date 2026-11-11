# Pantalla 17 · Propuesta enviada

## Referencia y alcance

- Figma: https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1069
- Estado: `Artista / Job Board - Propuesta enviada`, 1440×976.
- Ruta/trigger: `/job-board/` → detalle → completar propuesta → enviar correctamente.
- Rama: `valentina/rediseno-laura`; versión `2.2.3-valentina.rediseno-laura.31`.
- Base previa: `17035b3ac6a1b0853d105120b743ed28cbc1d8ad` (.30).
- Runtime: HTML/CSS/JS existente, sin cambios en tablas, auth, RLS, eventos ni validaciones.
- Sistema de diseño: `tokens.css`, `components.css`, navegación/footer de `organisms.js`; búsqueda Figma del sistema existente sin nuevos componentes utilizables. No se modificaron componentes compartidos.

| Referencia | Ruta/estado | Datos | Superficie | Visual | Funcional |
| --- | --- | --- | --- | --- | --- |
| 801:1069 | Job board / envío correcto | Solicitud y propuesta guardada por el flujo existente | `renderProposalSent`, CSS screen17 | Coincide en comparación controlada | Simulado |

## Cambios aislados

- `public/shared/css/job-board-screen17.css`: todas las reglas dependen de `.jbf-is-sent`; estilos retirados al cambiar de vista. No cambia feed ni detalle.
- `public/job-board/index.html`: carga de esa hoja únicamente.
- `public/shared/js/job-board-feed.js`: dos imágenes originales en el markup de confirmación y comentario de referencia. Sin cambios de handlers/datos.
- Assets: `public/shared/assets/figma/job-board-screen17/check.svg` (24×17.3333 en slot 32×32) y `arrow-right.svg` (18×18). Descargados originales, sin redibujar ni referencias temporales en runtime.
- `tests/job-board-screen17.test.js`: render real del controlador con valores distintos de Figma, escape de texto, precio/moneda/fecha, assets, acciones y retiro de la clase al volver.

## Evidencia visual

Browser integrado disponible y usado, sin Playwright alternativo. Para los anchos exactos se cargó la página real en iframe del mismo origen; no hay cambios de viewport ni fixtures persistidos por esa comparación. Solo se invocó el render de éxito con contenido sintético del frame (Camila R., $450, 25 de julio) para comparar el layout. El flujo de formulario se probó por separado con sus valores actuales.

- Fuente descargada: `C:/Users/Dev/AppData/Local/Temp/opencode/screen17-figma.png`.
- Antes: `C:/Users/Dev/AppData/Local/Temp/opencode-browser-FE4KoX/0/screenshot.jpeg`.
- Después: `C:/Users/Dev/AppData/Local/Temp/opencode-browser-sch0on/0/screenshot.png` (render del frame dentro de la captura completa).
- Comparación: tile 64×64 en y=168; panel 576 px en x=421 a 1440; título Archivo Black 36/39.6; cuerpo Inter 16/24; metas JetBrains Mono 11; botones 340×52. Ajustado padding del panel tras primera captura. Diferencias subpíxel de rasterización no se presentan como igualdad binaria.
- Anchos 1920, 1440, 1280, 1024, 768 y 390: `scrollWidth === innerWidth`; botones sin contenido cortado. A 390 panel de 358 px con filas que reordenan contenido. Íconos no vacíos y geometría efectiva 24×17.32 y 18×18.
- Captura móvil adicional bloqueada por ventana no visible del Browser; medición responsive y prueba de teclado sí completadas. No se afirma comparación visual móvil contra un frame inexistente.

## Flujo y comprobaciones

1. Local seguro ya activo (`node scripts/release/local-preview.cjs`); no se cerró el proceso existente. `WEOTZI_PREVIEW === true`, identidad ficticia y control de entorno visibles.
2. `/preview/preview-local-safe/job-board/?solicitud=JB-24872`: precio 450, duración 1 día, 1 sesión y mensaje de prueba. Clic en Enviar propuesta → confirmación, precio/fecha actuales y vista `sent`.
3. Ver mis postulaciones → `/artist/applications/?tab=jobboard`, listado cargado y nueva propuesta simulada visible al navegar.
4. En la comparación responsive, Tab enfoca Seguir explorando solicitudes con anillo azul de 3 px; Enter vuelve al feed y retira `.jbf-is-sent`.
5. Sin errores de consola observados al cerrar el recorrido. Sin pantalla vacía ni overlay de error.
6. Pruebas de pantallas 15/16 y nueva regresión: 9/9. Suite completa: 474/474. `npm run check:release` aprobado; `git diff --check` sin errores.

## Límites y diferencias intencionales

- El cliente y fecha del envío real pueden diferir del ejemplo Figma: se preservan las fuentes dinámicas originales. No se fuerza Camila ni una fecha histórica sobre una propuesta real.
- La preview simula guardados y notificaciones: no se enviaron emails ni se verificó persistencia Supabase. El adaptador existente guarda la propuesta sintética, pero el listado puede mostrar el mensaje como título y `request_id` nulo para estas solicitudes de muestra. Es límite previo de la simulación y no se modifica otra pantalla para disimularlo.
- Recargar la confirmación vuelve al feed según navegación existente; no se introdujo una ruta de éxito nueva ni persistencia adicional.
- El ojo flotante pertenece al entorno seguro, no a Figma; se conserva.

## Resultado y recuperación

**passed** para implementación visual y flujo simulado dentro del alcance. La publicación solo se considera confirmada cuando autoentrega obtiene CI aprobado y la misma SHA/versión de `https://preview.weotzi.chat/api/release`.

Preview: https://preview.weotzi.chat/job-board/ (alcanzar la confirmación enviando una propuesta de prueba).

Revertir el commit de esta entrega y preparar una nueva versión para recuperar .30; no hay migraciones ni datos remotos que revertir. Integración a main y rollback operativo corresponden a Isaí.
