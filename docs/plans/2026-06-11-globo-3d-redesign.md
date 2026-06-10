# Rediseño del Globo 3D — /explore/globe

Estado: **en curso** (rama `feature/globe-redesign`)
Decisiones tomadas con Isaí el 2026-06-11.

## Objetivo de producto

El globo es un **buscador mundial de artistas y estudios** y la experiencia
"wow" de la marca. No es el buscador principal (ese es `/marketplace`); convive
con `/explore` (mapa de cercanía) como vistas complementarias en evaluación.

Casos de uso clave:
1. Buscar un artista/estudio/ciudad/estilo y ver el resultado EN el globo.
2. Seleccionar un **estudio** → ver todas sus **sedes** destacadas en el globo
   con su tarjeta (roster, spots, perfil).
3. Seleccionar un **artista que viaja** → ver su **itinerario en orden**
   (dónde está hoy, a dónde va, en qué estudio tatuará en cada ciudad) con una
   **animación de avión** saltando ciudad a ciudad y la tarjeta de cada parada.

## Decisiones de diseño

| Tema | Decisión |
|---|---|
| Motor | **Three.js WebGPU + TSL**, vendorizado (sin build step). Fallback automático a WebGL2 donde no haya WebGPU. cobe se retira de esta página. |
| Entrada | **Search-first minimal**: globo limpio girando + buscador prominente. CERO labels flotantes por defecto; la información aparece al buscar/seleccionar. |
| Estética | **Tierra realista nocturna**: luces de ciudad (NASA night lights), atmósfera con glow fresnel, estrellas, marcadores/arcos neón sobre paleta de marca. |
| Datos | Se reutiliza el modelo existente: `artists_with_location` (roster), `artist_tattoo_locations` (itinerario: period_type current/upcoming, fechas, studio_id, sort_order), `studios` + `studio_locations` (sedes con lat/lng). **No se requieren migraciones.** |

## Arquitectura

```
public/explore/globe/index.html      ← página nueva (search-first)
public/shared/js/globe/
  globe-engine.js                    ← Three.js WebGPU: escena, tierra, atmósfera,
                                        estrellas, marcadores instanciados, arcos,
                                        avión, cámara cinematográfica, picking
  globe-data.js                      ← capa de datos (portada del explore-globe.js
                                        actual): fetchArtists, fetchStudios,
                                        fetchArtistItinerary + caches
  globe-app.js                       ← orquestación UI: buscador, tarjetas,
                                        timeline de itinerario, tour del avión
public/shared/css/explore-globe.css  ← reescrito (limpio, glass sobre canvas)
public/shared/vendor/three/          ← three.webgpu.js, three.tsl.js, addons
public/shared/img/globe/             ← texturas (earth lights/atmos/normal, MIT
                                        del repo de three.js)
```

- Import map en el HTML: `three` y `three/webgpu` → build webgpu vendorizado,
  `three/tsl` → build tsl, `three/addons/` → carpeta addons.
- `WebGPURenderer` con `forceWebGL` automático si `navigator.gpu` no existe.

## Experiencia (flujo)

1. **Entrada**: tierra nocturna girando lento, estrellas, buscador centrado
   arriba ("Busca artistas, estudios, ciudades o estilos"), contador discreto
   del roster. Nada más.
2. **Búsqueda**: typeahead agrupado (Artistas / Estudios / Ciudades / Estilos).
   Elegir resultado → la cámara vuela al punto, marcador pulsa, tarjeta glass
   aparece (lado izquierdo desktop, bottom-sheet móvil).
3. **Tarjeta de artista**: foto, estilos, precio, CTA Cotizar / Ver perfil.
   Si tiene itinerario: timeline "Ahora en X · Próximo: Y (fechas)" + botón
   **"Ver viaje"** → modo tour.
4. **Modo tour (avión)**: la cámara se aleja, se dibujan los arcos del
   itinerario en orden, un avión 3D recorre cada arco; al aterrizar en cada
   ciudad salta la mini-tarjeta de esa parada (ciudad, fechas, estudio(s) donde
   tatuará, agenda_status). Controles: pausa/siguiente/salir.
5. **Tarjeta de estudio**: al seleccionar un estudio se destacan TODAS sus
   sedes (marcadores hermanos + anillos), la tarjeta lista las sedes y el
   roster; clic en una sede → la cámara salta a ella.

## Fases

- [x] Decisiones de producto/diseño
- [x] F1 — Motor: tierra nocturna + atmósfera + estrellas + marcadores + cámara
      + picking + fallback WebGL. **Verificado en navegador con WebGPU real**;
      bug de alineación textura/marcadores corregido (la rotación π duplicada
      mandaba Buenos Aires a Australia).
- [x] F2 — Search-first UI: typeahead agrupado verificado ("berlin" → estudio +
      ciudad), tarjeta de artista (chips, precio, CTAs, itinerario) y tarjeta
      de estudio con 4 sedes clicables verificadas en vivo.
- [x] F3 — Tour: arcos + avión + tarjetas por parada verificados con itinerario
      real de 5 ciudades (Rosario→Melbourne→Toronto→Berlín→NY); re-encuadre de
      ciudad al aterrizar añadido tras la primera prueba.
- [ ] F4 — Pulido pendiente de revisión con Isaí: probar en móvil real,
      ajustar estética del avión/arcos a gusto, microinteracciones, estados
      vacíos, rendimiento en hardware modesto (fallback WebGL solo se probó
      por código, no en un navegador sin WebGPU).
- [ ] Merge a main tras la revisión de F4

## Colateral arreglado durante la verificación

La telemetría (`logging-service.js`) llevaba rota desde el hardening RLS del
2026-06-10: su INSERT a `session_logs` usaba `.select()` (RETURNING exige
SELECT, ahora solo-soporte). Se quitó el RETURNING, los updates filtran por
`session_id` y el endpoint `/api/session-log` hace fallback a `session_id`
para la geolocalización.

## Notas técnicas

- Marcadores: `InstancedMesh` (un draw call para todo el roster) con billboard
  + glow TSL; picking por raycast contra esfera + KD de marcadores próximos.
- Arcos: curvas Bézier cúbicas elevadas sobre la esfera, tubo fino con
  `dashOffset` animado (TSL) para el efecto "trazo que avanza".
- Avión: primitiva estilizada (paper-plane) orientada por la tangente de la
  curva; cámara con offset suave (lerp) siguiendo el avión durante el tour.
- Rendimiento: DPR cap 2, `powerPreference: high-performance`, pausa de render
  cuando `document.hidden`, texturas 2K (≈1.5MB total), sin postprocesado en
  móvil.
- El JS viejo (`explore-globe.js`, 110KB) se elimina al completar F2 — la capa
  de datos útil se porta a `globe-data.js`.
