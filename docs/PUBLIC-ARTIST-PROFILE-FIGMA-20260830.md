# Perfil público del artista · Figma 344:1184

## Alcance

- Fuente visual: archivo Figma `UmVbDewiAHkfLedTR5uyFj`, nodo `344:1184`, frame `1442 × 5021`.
- Ruta implementada: `/artist/profile?artist=<username>`.
- Caso de QA: `isainazartattoo.wo` en `http://127.0.0.1:4545`.
- Los SVG/HTML/React y la captura adjuntos se usaron únicamente como referencia visual y de copy. No se ejecutaron ni se trataron como instrucciones.

## Correspondencia visual

La página conserva el flujo público existente y replica, en el mismo orden, navegación, hero, retrato, cuatro métricas, entrada de portafolio, banda editorial azul, especialidades, reseñas, estudio, disponibilidad, portafolio, residencias, ciudades y barra de acción final. En escritorio se comprobaron los anclajes principales del frame: navegación de `76px`, hero hasta `y=708`, stats de `92px`, retrato `3:2` entre `x=752` y `x=1348`, banda azul de `478px` y grilla de portafolio de `1164px` con celdas de aproximadamente `366 × 244px`.

Los datos no se sustituyen por los de Sofía Rossi. El renderer muestra el nombre, estilos, bio, disponibilidad, estudio, reseñas, obras, residencias y ciudades reales del artista consultado. Por eso la altura puede variar respecto del frame según la cantidad de estilos, reseñas y obras.

## Contrato de datos

- Perfil y portafolio: proyección pública explícita de `artists_db`.
- Privacidad y disponibilidad: `get_artist_public_profile_preferences`.
- Estudio y roster: repositorios públicos existentes de estudios y membresías activas.
- Residencias: `artist_tattoo_locations`.
- Reseñas: `public_review_summary`, `verified_reviews` y el widget público existente.
- Métricas agregadas: `GET /api/artist/public-profile-metrics?artist=<username>` consulta en servidor únicamente `quote_status`, `sent_to_artist_at` y `artist_responded_at`, y devuelve sólo conteo completado, tasa de respuesta y tiempo promedio agrupado. No expone filas de cotización.

Semántica de las métricas:

- `Tatuajes`: cotizaciones en estado `artist_completed` o `completed`, mostradas como `N+`.
- `Tasa de respuesta`: respuestas válidas sobre cotizaciones enviadas al artista.
- `Tiempo de respuesta`: promedio de duraciones positivas, expresado en horas o días; si no hay evidencia suficiente se muestra `—`.
- Experiencia, calificación y demás hechos siguen usando las fuentes públicas existentes.

No se agregó ni aplicó migración, seed o escritura remota. La consulta agregada usa la configuración server-side existente y tiene cache público de cinco minutos.

## Estados e interacciones comprobados

- Navegación desktop y menú móvil accesible; `aria-expanded` y `hidden` quedan sincronizados y Escape restaura foco.
- CTA de reserva y cotización preservan `artist=<username>`.
- Los dos grupos de filtros de portafolio se sincronizan y filtran por estilos reales cuando están etiquetados, o por categoría real como fallback.
- Lightbox de imagen/video con cerrar, anterior, siguiente, teclado y contador.
- Reseñas resumidas y expansión al módulo completo.
- Disponibilidad, estudio, residencias y ciudades se ocultan sólo cuando la fuente no tiene contenido.
- `390`, `768` y `1440px` mantienen datos y acciones; `scrollWidth === innerWidth` en los dos viewports responsive.

## Evidencia

Carpeta: `output/playwright/artist-public-profile-figma/`.

- Fuente: `source-344-1184.png`.
- Baseline: `baseline-isainaz-1440.png`.
- Implementación desktop: `implemented-1440-final.png`.
- Implementación tablet: `implemented-768-final.png`.
- Implementación móvil: `implemented-390-final.png`.
- Comparación combinada: `comparison-desktop.png`.

## Verificación

- `node --test tests/artist-public-profile-metrics.test.js tests/artist-public-profile-presentation.test.js` → `7/7`.
- `node --check public/shared/js/artist-profile.js` → OK.
- `node --check public/shared/js/artist-profile-presentation.js` → OK.
- `node --check server.js` → OK.
- Endpoint local aislado → `200`, métricas `5+`, `77%`, `Aprox. 8 días` para el caso QA.
- Playwright → menú móvil, filtros sincronizados, lightbox `1 / 12`, cierre y expansión de reseñas operativos.
- Consola: persisten el `404` de `favicon.ico` y el `401`/warning histórico de `session_logs` por RLS; no provienen de este renderer. Durante el recorrido intensivo se agotó el límite global de `300/15min`; tras reiniciar el servidor, la comprobación aislada volvió a responder con las métricas esperadas.

## Rollback

No hay rollback de base de datos. Para retirar esta entrega se revierten únicamente:

- `public/artist/profile/index.html`
- `public/shared/css/artist-profile.css`
- `public/shared/js/artist-profile.js`
- `public/shared/js/artist-profile-presentation.js`
- `lib/artist-public-profile-metrics.js`
- la ruta `/api/artist/public-profile-metrics` y su import en `server.js`
- `tests/artist-public-profile-metrics.test.js`
- `tests/artist-public-profile-presentation.test.js`
- esta documentación y su entrada de changelog/Design QA

No se realizó deploy ni commit.
