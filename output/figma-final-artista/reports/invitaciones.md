# Reporte · área invitaciones (`/artist/invitations`)

Figma "We Otzi Pantallas final" (`w3JA83CcP5ISKjyOu87mx1`). Los nueve frames del área están implementados y funcionan en el preview local. Este reporte incluye las **rondas 1 y 2 de corrección** (auditoría Figma vs implementación).

> **Decisión pendiente (bloquea el P1 del mapa):** para que 2007:5792/5793 muestren la geografía del Figma hay que aprobar la descarga de `countries-110m.json` (paquete npm `world-atlas@2`, ≈105 KB, licencia ISC, datos Natural Earth de dominio público). El código ya está listo: con el archivo en `public/shared/geo/countries-110m.json` y `data-geography="/shared/geo/countries-110m.json"` en `#ism-stage`, el globo dibuja costas y fronteras Natural Earth y el pie pasa a decir "Geografía: Natural Earth · escala 1:110m.".

## Frames

| Frame | Estado | Fidelidad | URL de QA |
| --- | --- | --- | --- |
| 801:540 Listado de estudios | rediseñada | alta | `/artist/invitations/` |
| 801:541 Detalle y condiciones | rediseñada | alta | `?invitacion=0000c0de-0000-4000-8000-1dc100000001` |
| 2007:5792 Mapa de estudios | creada | parcial (geografía) | `?vista=mapa&grupo=0000c0de-0000-4000-8000-1da100000002,0000c0de-0000-4000-8000-a50000000004` |
| 2007:5793 Mapa · detalle | estado nuevo | parcial (geografía) | `?vista=mapa&estudio=0000c0de-0000-4000-8000-a50000000004&grupo=…` (mismo grupo) |
| 2007:5794 Detalle de estudio ampliado | creada | alta | `?estudio=0000c0de-0000-4000-8000-a50000000004` |
| 2007:5795 Escribir al estudio | creada | alta | `?estudio=…a50000000004&contactar=1` |
| 801:1101 Solicitar cambios | sin cambios de diseño | alta | `?invitacion=…1dc100000002&drawer=cambios` |
| 801:1102 Invitación aceptada | sin cambios de diseño | alta | `?invitacion=…1dc100000004&drawer=aceptada` |
| 801:1103 Invitación rechazada | sin cambios de diseño | exacta | `?invitacion=…d10000000003&drawer=rechazada` |

Las capturas del Figma están en `output/figma-final-artista/frames/`. Las de la implementación, todas rehechas en esta ronda, están en `output/figma-final-artista/shots/invitaciones/`.

## Ronda 2 · globo (P1 de 2007:5792/5793)

La auditoría marcó que el globo no reproduce el Figma: Europa en manchas, sin fronteras, "peines" junto al Polo Norte y el pie de geografía distinto. El Figma usa Natural Earth 1:110m (sus mapas, nodos 2007:4911 y 2007:5060, son capturas raster de un globo d3, no vectores). Ese dato no está en el repo ni en la máquina y bajarlo es una descarga de terceros que necesita aprobación, así que no se descargó.

Qué se hizo:

- **Natural Earth listo para enchufar.** `invitations-globe.js` decodifica TopoJSON (formato world-atlas) sin dependencias:
  - La tierra se rasteriza a una máscara de 4096×2048 con mipmaps, en un solo trazado par-impar (sin costuras entre países). Resuelve el antimeridiano y la Antártida.
  - Las fronteras (arcos compartidos por dos países) se dibujan como vectores blancos en un canvas nuevo (`#ism-borders`) encima de la tierra. Miden 0,5px a zoom 1,16 y 0,9px a zoom 2,6, como en el Figma.
  - `invitations-map.js` lo carga desde `data-geography` (solo rutas del mismo origen) y cambia el pie a "Geografía: Natural Earth · escala 1:110m.".
  - Probado con una topología sintética: `shots/invitaciones/qa-natural-earth-topologia-sintetica.png` (es una grilla de 5°, no geografía real).
- **Retícula como el Figma.** Pasa a una línea cada 10° (antes 15°), en arena al 45% (#EEEAE1 sobre blanco, medido en el raster del Figma). Los meridianos mayores llegan al polo, como `d3.geoGraticule10`.
- **Respaldo COBE sin artefactos polares.** La máscara de COBE marcaba como tierra todo el océano Ártico, lo que dibujaba los "peines" junto al polo.
  - Ahora se recorta a 73,5°N. En Groenlandia y Ellesmere sube con transición suave hasta 83,6°N.
  - En latitudes altas se suaviza más.
  - Se pierden Svalbard y las islas rusas del Ártico hasta tener el dato real.
- **Pie honesto.** Mientras se dibuje la máscara de COBE, el pie sigue diciendo "Geografía: máscara de tierra de COBE · escala aproximada.".

Qué sigue igual: con la máscara de COBE (1,4°/px), Gran Bretaña, Irlanda, Italia y los Balcanes no se reconocen y no hay fronteras. Por eso 5792 y 5793 quedan con fidelidad **parcial** hasta que se apruebe el archivo.

## Ronda 1 · qué se corrigió

- **Globo (P1, 2007:5792/5793):** la tierra ya no es un mapa de puntos. Ahora es una superficie beige rellena (`--figma-sand-border`) sobre el océano blanco, con la retícula por debajo como en el Figma. Lo dibuja `invitations-globe.js`, un shader WebGL propio que invierte la proyección de `invitations-model.js` (los marcadores siguen alineados) y muestrea la máscara de tierra que ya trae COBE. No se sumaron dependencias, CDN ni datos.
- **Listado (801:540):**
  - Los "Ver estudio →" salen subrayados y el placeholder de búsqueda en gris oscuro: hubo que ganarle en especificidad a `.wo-app a` y `.wo-app input::placeholder` del DS.
  - En el índice, la invitación rechazada lleva el punto rojo. La invitación del mes es 01 y el resto va por fecha, como en el Figma. Los nombres van cortos y enteros ("Fierro Negro", "Costa Ink"); el nombre completo queda en `title` y `aria-label`.
  - "Ordenar" con "Más antiguas primero" o "Estudio A–Z" ordena la lista entera, sin tarjeta del mes.
  - La invitación del mes se elige sobre todas las invitaciones. Un filtro o una búsqueda ya no promueve otra.
  - Desde 1280px el nombre de la fila va en una línea. Los nombres largos bajan a 28px, como "Tierra Firme Tattoo" en el Figma. Entre 1025 y 1279px los nombres cortan por palabras; antes cortaban letra por letra.
- **Detalle (801:541):** se ajustaron los espaciados entre descripción, links, chips, pestañas y regla. Quedan a ±1px del Figma.
- **Mapa:**
  - "Ver invitación" y "Ver conversación" salen subrayados.
  - El grupo abierto queda en la URL (`&grupo=<id>,<id>`), se conserva al entrar al detalle ("2 de 2") y se recupera al volver a resultados.
  - Los grupos de marcadores se fusionan si quedan a menos de 32px, así ya no se pisan en el globo de 390px.
- **Escribir al estudio (2007:5795):**
  - La separación etiqueta→control ya coincide con el Figma. El `<legend>` no recibía el gap del fieldset.
  - El textarea mide 148px.
  - Las fechas muestran "dd/mm/aaaa" liso, sin el ícono nativo, y el selector se sigue abriendo al tocar el campo.
- **Detalle de estudio (2007:5794):** se quitó el subtítulo inventado "Las respuestas te llegan al Inbox de We Ötzi.".
- **Drawers:**
  - En 801:1101 la etiqueta y el placeholder salen en `--neutral-400`.
  - En 801:1102 hay una X de cierre discreta.
  - En 801:1103, "Ver otras invitaciones" vuelve al listado también cuando el drawer se abrió desde el detalle.

## Qué no se corrigió (y por qué)

- **Citas en Space Grotesk:** la fuente no está en el DS y el DS no se edita. Hay que decidir si se suma como token o se aprueba Inter.
- **Topbar y pie:** el Figma subraya COTIZACIONES o INBOX, no muestra badges ni `<weotzi-product-footer>`. Es del área Dashboard y el pie está en todas las páginas del artista.
- **"or browse files" en las fotos de 801:541:** se mantiene la decisión (es UI de carga, no del artista). Falta que diseño la confirme o la retire del Figma.
- **Rótulo del CTA en 2007:5794:** el mockup es inconsistente. 5794 dice "Escribir al estudio" junto a "Le escribiste hoy" y 5795 dice "Escribir de nuevo". Se sigue a 5795; falta que diseño confirme.
- **Geografía Natural Earth del mapa (P1):** el código ya la soporta, pero falta el archivo `countries-110m.json`. Bajarlo es una descarga de terceros que hay que aprobar y revisar (ver el aviso al principio).

## Backend (no aplicado)

Sin cambios en esta ronda. La migración es `supabase/migrations/20261028180000_invitaciones_estudios_contacto.sql`, con su reversa:

- **Columnas nuevas en `studios`:** el perfil de trabajo del estudio.
- **RPC `contact_studio_as_artist`:** abre o reutiliza el hilo del Inbox, con validaciones y un freno de 10 mensajes por hora.
- **Degradación:** si la migración no está aplicada, el repo sigue funcionando y muestra un error claro.

## Faltantes y riesgos

- **Mapa:** faltan las costas y fronteras Natural Earth (severidad alta, es el P1 de la auditoría). El renderer y la carga ya están; falta aprobar el archivo de world-atlas, guardarlo en `public/shared/geo/` y agregar `data-geography` en `#ism-stage`.
- **Panel del estudio:** el estudio no puede editar las columnas nuevas (área estudios). Severidad media.
- **Respuesta del estudio:** no hay Inbox para estudios ni email de aviso. Severidad media.
- **Estudios sin cuenta:** no pueden recibir mensajes. Severidad media.
- **Tipografía de citas:** pendiente de la decisión de DS. Severidad baja.

## Tests

`node --test "tests/*.test.js"` → 612 tests: 607 pass, 4 fail, 1 skipped.

- **Fallos preexistentes:** los 3 de PowerShell 7.
- **Fallo de otra área en curso:** 1 (`dashboard-figma.test.js`). No carga archivos de invitaciones.
- **Invitaciones:** 25/25. La ronda 1 sumó 6 tests (orden del índice, nombres cortos, listado y orden, clustering, globo sin dependencias, especificidad CSS y drawers). La ronda 2 suma 4:
  - decodificación TopoJSON y detección de fronteras;
  - antimeridiano y polos;
  - fronteras proyectadas igual que los marcadores, con el ancho medido en el Figma;
  - orden de capas, retícula de 10° y pie.

## Notas

- **Datos compartidos del preview:** el store vive en un `localStorage` que comparten todas las pestañas, y otras pestañas lo pisan seguido. Si aparecen pocas invitaciones, usá "Reiniciar datos". Las capturas con `shot.sh` usan un perfil limpio.
- **Navegador integrado:** `requestAnimationFrame` se pausa en pestañas o paneles no visibles, así que el globo no se dibuja en segundo plano.
- **QA del mapa con otra geografía:** con la página abierta, `WoInvitationsMap.setGeography(topology)` carga cualquier TopoJSON en caliente, sin recargar.
- **Capturas a 390px:** se verificaron en el navegador integrado. No hay scroll horizontal (el único desborde es el badge de la topbar, de Dashboard). Los grupos de marcadores no se pisan: se comprobó con la proyección real a 354×420.
