# Pantalla 15 · Explorar solicitudes

- Referencia: [Figma 801:1067](https://www.figma.com/design/w3JA83CcP5ISKjyOu87mx1/We-Otzi-Pantallas-final?node-id=801-1067), leído con get_design_context y captura 1440×1975.
- Versión: `2.2.3-valentina.rediseno-laura.29`; rama `valentina/rediseno-laura`.
- Entrega: <https://preview.weotzi.chat/job-board/>.
- Local seguro: `http://localhost:4647/preview/preview-local-safe/job-board/`, WEOTZI_PREVIEW=true. Se reutilizó el proceso de preview de Dev ya existente en 4647.

## Inventario

| ID | Rol / URL / estado | Referencia | Visual | Funcional | Evidencia |
| --- | --- | --- | --- | --- | --- |
| P15-01 | Artista · `/job-board/` · feed | 801:1067 | Coincide en composición, muestras y recursos | Simulado | Captura comparada con Figma; medidas de panel y sponsor |
| P15-02 | Búsqueda sin resultados / restaurar | Misma pantalla | Coincide con componentes existentes | Simulado | Buscar texto inexistente → vacío → Ver todas las solicitudes |
| P15-03 | Filtros / guardados / ver todo | Misma pantalla | Coincide | Simulado | Fine Line: 12; Lima: 3; guardar/filtrar/recargar/quitar; ver todo muestra más de cinco solicitudes |
| P15-04 | Detalle / volver | Fuera del rediseño solicitado | Sin rediseño | Simulado | Clase visual retirada al entrar y restaurada al volver; no se editan detalle/formulario |

Solo se modifica el HTML de `/job-board/`, su controlador y una hoja visual específica. No se cambian tokens, header/footer compartidos, otras páginas, repositorios, servidor, migraciones ni permisos. El subrayado de Cotizaciones y la ausencia de contadores/botón extra de modo siguen el frame, conservando enlaces y acceso al menú de cuenta. El soporte flotante no se dibuja en el feed. El ojo de control de preview permanece por política del entorno. El footer queda después del contenido, fuera del recorte del frame; la tercera fila puede recorrerse completa, sin cortarla en el límite del lienzo Figma.

## Composición y recursos

- Sidebar 281,6 px; contenido desde x=329,6, y=116.
- Encabezado 1066×96; sponsor x=329,6, y=240, ancho=1066, alto≈449 a 1440.
- Tarjetas 296×437,8; media 220; separación 20. Scroll horizontal interno de rieles, no de página.
- Archivo Black 400, Inter 400/600/700, JetBrains Mono; colores de tokens existentes, incluidos literales Figma ya disponibles en el DS.
- Ocho SVG originales locales en `public/shared/assets/figma/job-board-screen15/`: collapse (16×16), search (18×18), chevron (18×18), image (28×29,1), sponsor-arrow (18×18), heart (16×16), apply-arrow (14×14), applications-arrow (14×14). Feather equivalente existente para estrella, ubicación, rayo, acordeón y flecha de riel.
- Los archivos tienen contenido no vacío y geometría raíz original comprobada; todos los recursos visibles cargan en seis anchos sin imágenes rotas. El sponsor usa el placeholder literal de Figma, no una foto inventada.

## Datos y límites

Producción conserva consultas públicas abiertas, Featured/SavedRequests, ArtistAuth e imágenes dinámicas. No hay muestras como fallback de producción.

`job-board-screen15-preview.js` solo presenta las muestras con WEOTZI_PREVIEW=true. Copia las filas: no escribe ni reemplaza el store compartido ni altera los ejemplos de otras rutas. Los contadores de estilos corresponden a muestras filtrables, no a números decorativos. Guardados de esta muestra usan una clave local `:screen15`, no Supabase. Las primeras solicitudes conservan IDs de ejemplos existentes: Postularme conserva el aviso de duplicado, comprobado en QA; otra tarjeta abre el formulario habitual.

No se acredita envío real de propuestas, autenticación remota, email, cobros ni persistencia compartida. Patrocinio y registros son ficticios. `browse files` reproduce un placeholder, no agrega una función de carga.

## Validación

1. Cuatro regresiones Node/VM primero fallidas y después aprobadas: Ver todo aun con cinco tarjetas; USD compacto sin ocultar otras monedas ni cambiar detalle; muestras inactivas fuera de preview sin mutar fuentes; guardados locales aislados.
2. npm test: 469/469 aprobadas; autoentrega repite suite/política.
3. Browser integrado permitió DOM, pero rechazó capturas con `Screenshot needs a visible tab`. Valentina autorizó expresamente Playwright alternativo. Se reutilizaron Playwright de caché y Chrome instalado, sin instalar dependencias.
4. Capturas y medidas a 1920, 1440, 1280, 1024, 768 y 390: ancho del documento igual al viewport, sin imágenes rotas ni overlays de error. Comparación del recorte 1440×1975 con Figma. Rasterización y subpíxeles de Chrome/Figma no implican igualdad de bytes de imagen.
5. Búsqueda/Enter, vacío/restaurar, guardar/filtro/recargar/quitar, ver todo, estilo/ciudad, colapsar/expandir, duplicado, abrir otra solicitud/volver aprobados en simulación. Filtros expandidos a 390 sin overflow. Mis postulaciones conserva `/artist/applications?tab=jobboard`.
6. Sin excepciones JavaScript. Único error: favicon.ico 404 preexistente, ajeno a los recursos visibles; no se amplía el alcance para modificarlo.

Evidencia local en `C:/Users/Dev/AppData/Local/Temp/opencode/`: `pantalla15-figma.png`, `pantalla15-reference-crop.png`, `pantalla15-{1920,1440,1280,1024,768,390}.png`, `pantalla15-empty.png`, `pantalla15-mobile-filters.png`, `pantalla15-detail-unchanged.png`, `pantalla15-qa.json` y script `pantalla15-qa.cjs`. Captura comparativa abierta en el panel de revisión. No contienen información de usuarios reales.

## Publicación y recuperación

Autoentrega comprueba Verify delivery del push y la misma SHA/versión en `/api/release`; el cierre informa los identificadores comprobados. Actualizar PR #12 sin mezclar a main.

Revertir este commit con nueva entrega versionada recupera `.28` (`2dbaab9415b75742fb0c56feb9dbf45604bc8c6e`). Sin migraciones ni datos remotos que revertir.
