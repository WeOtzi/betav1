# Design QA — Tarjeta del globo sin scroll 2026-08-31

## Alcance y evidencia

- Fuente visual: `C:\Users\ISA~1\AppData\Local\Temp\codex-clipboard-b44fab36-bd7c-4323-8dd6-45a7eda5c4d0.png`, `503 × 407` px.
- Implementación enfocada: `C:\dev\weotzi-unified\output\playwright\travel-cobe-no-scroll\desktop-panel-2042-crop.png`, `503 × 407` px.
- Comparación combinada: `C:\dev\weotzi-unified\output\playwright\travel-cobe-no-scroll\comparison-no-scroll.png`, `1026 × 443` px. La fuente y la implementación se abrieron y juzgaron juntas en un mismo raster.
- Vista desktop completa: `C:\dev\weotzi-unified\output\playwright\travel-cobe-no-scroll\desktop-viewport-2042.png`, viewport CSS y captura `2042 × 1100`, DPR `1`.
- Evidencia responsive: `C:\dev\weotzi-unified\output\playwright\travel-cobe-no-scroll\tablet-1006.png` y `C:\dev\weotzi-unified\output\playwright\travel-cobe-no-scroll\mobile-390.png`.
- Estado comparado: destino seleccionado Berlín, confirmado, `3 sep – 5 sep`, `Bauhaus Ink Fest`, dirección `Berlín, Alemania`, resumen `Confirmar alojamiento en Kreuzberg.`, ID `83000000-0000-4000` y CTA `VER VIAJE`.
- Normalización: el recorte de implementación replica las dimensiones de la fuente (`503 × 407`); no hubo reescalado ni diferencia de densidad.

## Hallazgos

- No quedan diferencias accionables P0, P1 o P2. La desaparición de las barras vertical y horizontal es la corrección solicitada y libera el área necesaria sin omitir copy ni controles.
- La tarjeta final usa `overflow: visible` y `max-height: none`; todo el contenido y el CTA quedan visibles simultáneamente y dentro del host del globo.
- A `2042px`, el componente mide `1200 × 1235`, la tarjeta `420 × 314.8` y permanece completamente dentro del componente; no existe overflow horizontal del documento.
- A `1006px`, la tarjeta mide `337 × 330`, con `scrollWidth === clientWidth === 337` y `scrollHeight === clientHeight === 330`; el host conserva `680px` de alto.
- A `390px`, la tarjeta mide `355 × 376`, con `scrollWidth === clientWidth === 355` y `scrollHeight === clientHeight === 376`; el host compacto conserva `960px` de alto y el documento no tiene overflow horizontal.

## Superficies de fidelidad

- **Tipografía:** se conservan la familia monoespaciada/display existente, pesos, versales espaciadas, jerarquía de ciudad y etiquetas, tamaños, interlínea y wrapping. No hay truncado.
- **Espaciado y layout:** el marco, padding, separadores, filas y CTA mantienen el ritmo de la fuente. Al crecer el contenido, el host ancho adquiere un mínimo de `680px` y el compacto conserva `960px`, evitando recorte en ambos modos.
- **Colores y tokens:** permanecen el fondo negro cálido, borde y estado amarillo, texto blanco roto, azul del destino y divisores grises del sistema Travel.
- **Calidad de imagen y activos:** el fondo sigue siendo el globo COBE/WebGL real (`data-renderer="cobe"`); no se reemplazaron rutas, punto, avión ni controles por aproximaciones raster, SVG o CSS.
- **Copy y contenido:** están visibles todas las etiquetas y valores del destino, incluido el resumen, ID y CTA. La captura final usa el mismo contenido legible que la referencia.
- **Interacción y accesibilidad:** la tarjeta continúa vinculada a la parada seleccionada y el CTA sigue operativo; eliminar el contenedor desplazable evita una segunda superficie de scroll sin retirar información.
- **Consola:** `0` errores de página en la captura final.

## Historial de comparación

1. Primera iteración: al cambiar la tarjeta a `overflow: visible`, las barras desaparecieron, pero a `1006px` el host heredaba sólo `260px` de alto y recortaba visualmente la parte inferior. Hallazgo responsive P1.
2. Corrección: se añadió un mínimo global de `680px` para `data-layout="wide"`; el modo compacto mantiene `960px`.
3. Segunda iteración: captura desktop enfocada y vistas responsive confirmaron toda la información dentro del globo, sin barras internas, sin recorte y sin overflow horizontal de página. No quedaron P0/P1/P2.

## Comprobaciones

- Prueba de regresión específica: la tarjeta expande su contenido y no crea scroll interno incluso cuando un consumidor carga CSS anterior.
- Validación fresca: `69/69` pruebas Travel y `23/23` pruebas compartidas aprobadas (`92/92` total, `0` fallos).
- Sintaxis del componente global: `node --check` aprobado. Los cuatro archivos de esta corrección aprobaron la comprobación de whitespace.
- COBE se mantuvo como renderer activo en desktop, tablet y móvil.
- No se hicieron escrituras remotas, deploy ni commit.

## Estado

final result: passed

---

# Design QA — Travel Figma 2026-08-30

## Alcance

- Fuente: archivo Figma `UmVbDewiAHkfLedTR5uyFj`.
- Implementación: `/artist/travel/` y vista pública `/travel/t/<slug>`.
- Estados evaluados: nueve de nueve.
- Método: cada captura de implementación se comparó en una imagen combinada con su fuente; las capturas aisladas no se consideraron evidencia suficiente.
- Carpeta de evidencia: `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa`.

## Matriz fuente → implementación → comparación

| Estado | Nodo | Fuente absoluta | Implementación absoluta | Comparación absoluta | Captura de implementación |
| --- | --- | --- | --- | --- | --- |
| Dashboard | `68:11882` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-main.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-main-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-main-final.png` | `1440 × 2181` |
| Crear viaje | `419:2487` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-create.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-create-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-create-final.png` | `1440 × 2181` |
| Viaje agregado | `131:14426` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-added.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-added-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-added-final.png` | `1440 × 1020` |
| Detalle | `132:14729` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-detail.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-detail-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-detail-final.png` | `1440 × 1584` |
| Editar viaje | `173:24897` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-edit.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-edit-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-edit-final.png` | `1440 × 1584` |
| Cambiar fechas | `173:25982` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-dates.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-dates-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-dates-final.png` | `1440 × 1584` |
| Vincular estudio | `173:26741` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-link.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-link-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-link-final.png` | `1440 × 1584` |
| Compartir itinerario | `173:27503` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-share.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-share-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-share-final.png` | `1440 × 1584` |
| Cancelar viaje | `173:28256` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\source-cancel.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-cancel-final.png` | `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\compare-cancel-final.png` | `1440 × 1584` |

Las nueve fuentes son archivos distintos. Sus prefijos SHA-256 son: dashboard `C36209988F88`, crear `E1ED40680680`, agregado `606518E9C77C`, detalle `92FAFE39C1FA`, editar `80FFA79B19EB`, fechas `28802313F49D`, vínculo `AA507C55D777`, compartir `6A8B8D936417` y cancelar `53B90840CB52`.

## Viewport y densidad

- Capturas de implementación tomadas por CDP con `devicePixelRatio = 1` verificado en página.
- Normalización del host: escala de emulación `0.8`; las medidas registradas siguen siendo píxeles CSS del viewport.
- Dashboard: lienzo completo `1440 × 2181`, compuesto desde segmentos del mismo viewport para conservar el topbar fijo y todo el scroll.
- Crear: `1440 × 2181`; éxito: `1440 × 1020`; detalle y modales: `1440 × 1584`.
- Fuentes Figma recibidas como exports escalados: dashboard `676 × 1024`, crear `678 × 1024`, éxito `1024 × 725` y los seis estados de detalle `931 × 1024`. Cada fuente se normalizó al lienzo de implementación sólo dentro de `compare-*-final.png`.

## Geometría desktop comprobada

| Superficie | Medida confirmada |
| --- | --- |
| Dashboard | `1440 × 2181`, sin overflow horizontal; reparto visible `2 confirmado / 3 pendiente / 3 finalizado`. |
| Detalle | `1440 × 1584`; footer a `y = 1490`, seis métricas, tres documentos y cinco acciones. |
| Editar | `1192 × 463` en `x = 124`, `y = 553`. |
| Fechas | `854 × 281.2` en `x = 293`, `y = 643.9`. |
| Vincular estudio | `1203 × 504.8` en `x = 118.5`, `y = 532.1`. |
| Compartir | `1209 × 342.4` en `x = 115.5`, `y = 613.3`. |
| Cancelar | `619 × 236.8` en `x = 410.5`, `y = 666.1`. |

### Corrección de ancho del dashboard

- La corrección más reciente usa como verdad visual `source-main-wide-2560.png`, captura Figma de `2560 × 2726` entregada por el usuario. La fuente anterior de `1444` px se conservó como contexto, pero no limita el ancho máximo actual.
- La medición de la nueva fuente fija el contenido entre `x = 480` y `x = 2080`: `1600` px útiles, divididos en globo `1200` px y agenda `400` px. El globo mide además `1235` px de alto.
- La implementación usa un shell fluido de hasta `1688` px exteriores con `44` px de padding por lado. A `2560` px se midieron exactamente shell `x = 436`, contenido `x = 480`, ancho útil `1600`, globo `1200 × 1235` y agenda `400 × 1235`.
- A `1444` px el shell ya no queda limitado a `1368`: ocupa el viewport, deja `1356` px útiles y reparte `1017 / 339` px. A `1280` reparte `894 / 298`; en ambos casos conserva la proporción `3:1` y el aspecto vertical del diseño.
- Passport dejó de usar anchos absolutos y conserva las proporciones Figma `278 / 278 / 278 / 232` con gap relativo; a `2560` el primer sello se midió en `346.625 × 421.425` px contando el padding interno de la grilla.
- Responsive comprobado en `2560`, `1444`, `1280`, `1024`, `768` y `390` px: `documentElement.scrollWidth` y `body.scrollWidth` coinciden con el viewport en todos los casos. Tablet y móvil mantienen sus disposiciones de dos y una columna.
- Densidad de la captura de implementación: viewport CSS `2560 × 1600`, screenshot `2560 × 1600`, sin reescalado. La fuente y la implementación se compararon juntas en `compare-main-wide-2560-top.png` y `compare-main-wide-2560-bottom.png`; se usaron además `impl-main-wide-1444.png` e `impl-main-wide-390.png` para comprobar la reducción fluida.
- La tipografía, los tokens de color, los assets del globo, los iconos y el copy no cambiaron en esta corrección; la revisión enfocada no detectó regresiones visibles en esas superficies.

## Comprobaciones funcionales y responsive

- Dashboard: filtros, destino, agenda, cronología y Passport se conservaron en el flujo compartido; no hay overflow horizontal de página.
- Crear: la ciudad recibe foco y caret al abrir; el diálogo sigue siendo desplazable cuando la altura disponible es menor.
- Viaje agregado: la confirmación muestra los datos del registro recién creado y permite volver a Travel.
- Detalle: conserva las seis métricas, tres documentos y cinco acciones; checklist y cronología siguen accesibles.
- Editar y fechas: los campos cargan los valores persistidos y las fechas usan la mutación transaccional correspondiente.
- Vínculo: el CTA deshabilitado conserva estado visual neutral; la solicitud usa el contrato seguro de estudio.
- Compartir: la URL mostrada usa `/travel/t/<slug>` y la vista pública consume la proyección limitada. Abrir el modal no altera la publicación ni expone una URL inactiva; sobre un enlace revocado, el primer **Copiar** lo habilitó y cambió a **Copiar ahora**, y el segundo lo copió conservando el slug original. Email/WhatsApp abren el destino después de habilitar y **Desactivar enlace** retiró la proyección pública. Ese control de privacidad ocupa el espacio libre del footer sin cambiar la geometría fuente. Evidencia adicional: `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0513b-824e-7ad0-aa8c-fba743805ccf\travel-design-qa\impl-public-share-final.png`.
- Cancelar: el modal conserva sus dos decisiones y la operación permite reactivación posterior cuando corresponde. A `390` px, el modal mide `374.4` px, su fila de aviso `339.2` px y el contenido `301.2` px, sin overflow; evidencia `impl-cancel-390-final.jpg`.
- Responsive `390`, `768`, `1100`, `1200` y `1280` px: sin overflow horizontal de página; crear conserva autofocus y scroll del diálogo; detalle retiene seis métricas, tres documentos y cinco acciones. A `1100` el Passport usa dos columnas fluidas; a `1200` el rail del detalle baja completo bajo el contenido; a `1280` entra el grid desktop `776 + 360` sin exceder el viewport. Evidencia: `impl-main-390-final.png`, `impl-main-768-final.png`, `impl-create-390-final.png`, `impl-detail-390-final.png`, `impl-detail-768-final.png` e `impl-cancel-390-final.jpg` en la carpeta de QA, más mediciones CDP de los tres anchos intermedios.
- Documentos: los tres metadatos demo tienen objetos privados reales; cada URL firmada respondió `200`, `application/pdf`, tamaño mayor que cero y cabecera `%PDF-`. La UI conserva abrir y eliminar, valida 10 MiB/MIME, compensa el objeto si falla la inserción y elimina primero el metadato para que un fallo de limpieza deje sólo un objeto privado reintentable, no una referencia rota.
- Datos remotos: ocho viajes demo; estados `2/3/3`; Barcelona Tattoo Expo `2025-12-05` a `2025-12-07`; `0` filas QA temporales.

## Historial de comparación

1. Se capturaron los nueve nodos y su contexto individual; el hash confirmó que no eran duplicados.
2. El dashboard se corrigió contra la comparación combinada: ancho de shell, filtros, globo, separación con cronología, Passport, CTA, bordes y altura total.
3. El detalle se compactó contra su referencia: banner, grid, rail de checklist/acciones, eventos y footer.
4. Los cinco modales se midieron por separado; se normalizaron alturas de controles, box sizing y posición vertical sin afectar el modal de creación.
5. Se regeneraron las nueve capturas finales y sus `compare-*-final.png` antes de la revisión responsive.
6. Se recorrieron `390`, `768`, `1100`, `1200` y `1280` px y se confirmó la conservación de contenido y acciones sin overflow horizontal global.
7. La comparación combinada de compartir se regeneró después de incorporar la revocación; aunque la captura CDP recortó una capa compuesta del extremo derecho, las mediciones DOM confirmaron **Copiar** y **Cerrar** dentro del modal y la captura nativa los mostró completos.
8. Se revalidaron la activación segura en dos pasos, la apertura de documentos/WhatsApp bajo gesto de usuario, la eliminación de documentos sin referencias rotas y el aviso de cancelación a `390` px.
9. Se contrastó la corrección inicial de `1280` px contra la nueva captura amplia entregada por el usuario. La comparación combinada mostró que la referencia usa `1600` px útiles; se reemplazó el tope rígido por un shell fluido, una grilla `3:1`, altura proporcional y Passport relativo, y se regeneró evidencia superior e inferior.
10. La medición renderizada confirmó los anclajes exactos `x = 480`, `1200 + 400` px a `2560`, la ampliación a `1356` px útiles en `1444` y ausencia de overflow global en seis anchos. Se abrió y cerró **Crear viaje** para confirmar que la interacción principal siguiera operativa.

## Estado

final result: passed

---

# Design QA — Integración del globo COBE en Travel 2026-08-31

## Alcance y fuente

- Fuente seleccionada para la barra de destino: `C:\Users\ISA~1\AppData\Local\Temp\codex-clipboard-36ebe06a-8173-42db-b8bd-c68879467ef8.png`, `2042 × 122`.
- Implementación a evaluar: `/artist/travel/`, incluyendo barra dinámica, globo global, recorrido de próximos viajes y modal Crear viaje.
- Navegador elegido y autorizado: navegador interno de Codex (`iab`), con servidor local en `http://127.0.0.1:4545`.
- Estado de QA: sesión autenticada y respuestas de Supabase/Google aisladas y deterministas en la pestaña de prueba; no se transmitieron credenciales ni se escribieron datos remotos.

## Evidencia renderizada y normalización

- Vista desktop: `C:\dev\weotzi-unified\output\playwright\travel-cobe-integration\desktop-viewport-2042.png`, `2042 × 1100` px, viewport CSS `2042 × 1100`, DPR `1`.
- Vista móvil: `C:\dev\weotzi-unified\output\playwright\travel-cobe-integration\mobile-390x844.png`, `390 × 843` px, viewport CSS `390 × 844`, DPR `1`.
- Estado Convención: `C:\dev\weotzi-unified\output\playwright\travel-cobe-integration\desktop-convention-modal.png`, `2042 × 1100` px.
- Control pausado del globo: `C:\dev\weotzi-unified\output\playwright\travel-cobe-integration\mobile-globe-390x844.png`, `390 × 843` px.
- Comparación enfocada combinada: `C:\dev\weotzi-unified\output\playwright\travel-cobe-integration\hero-reference-comparison.png`, `2042 × 294` px. Contiene en un mismo raster la fuente `2042 × 122` y la implementación recortada a `2042 × 120`; no fue necesario reescalar ni corregir densidad.
- La comparación completa se hizo con la captura desktop y la móvil; la banda enfocada se usó porque tipografía, distribución de cinco métricas y alineación no eran juzgables con suficiente precisión en una captura de página completa.

## Revisión de fidelidad

- **Tipografía:** familia, pesos Bauhaus, versales espaciadas, escala amarilla de métricas y jerarquía destino/fecha coinciden con la referencia. El contenido dinámico de Berlín es deliberadamente distinto del ejemplo de Barcelona.
- **Espaciado y layout:** la banda conserva `120px`, fondo oscuro continuo, bloque de destino a la izquierda y cinco métricas equidistantes. Las flechas solicitadas ocupan el espacio libre entre destino y métricas sin alterar su grilla. A `390px` la banda pasa a una composición legible sin solapamientos.
- **Color y tokens:** negro cálido, amarillo de acento, blanco roto y estados deshabilitados corresponden al sistema visual existente y a la referencia.
- **Imagen/activo:** el globo es COBE/WebGL real (`data-renderer="cobe"`, un `canvas`), no una aproximación raster, SVG o CSS. Las rutas, puntos y avión aparecen renderizados con la paleta Travel.
- **Copy/contenido:** `Próximo destino`, métricas, ciudad, fechas, tipo y etiquetas conservan el copy solicitado; los valores provienen del modelo de viajes y no de texto fijo.
- **Responsive y accesibilidad:** `scrollWidth === clientWidth === 390`; controles con nombres accesibles, barra `aria-live`, flechas con límites verdaderos y modal etiquetado. El botón del globo cambió de `Pausar animación` a `Reanudar animación` y volvió correctamente.

## Interacciones comprobadas

- La flecha siguiente cambió de Berlín a Ciudad de México y actualizó en conjunto fechas, días restantes, personas interesadas, estadía, clima, ciudad del clima, estudios y posición `2 / 5`; la flecha anterior regresó a `1 / 5` y quedó deshabilitada en el límite.
- `/artist/travel/?globe=cobe` se normalizó en ejecución a `/artist/travel/` y siguió renderizando COBE.
- Ciudad seleccionada en Google Places completó automáticamente `Barcelona` + `España`.
- `Estudio` propuso únicamente `Madrid Ink Studio` desde el directorio activo/completo; no expuso `Borrador Privado` y rechazó `Estudio inventado` con `Seleccioná un estudio existente.` antes de cualquier mutación.
- Al elegir `Convención`, el campo cambió a `Lugar`, mostró el placeholder de Google Maps y la selección `Fira Barcelona` actualizó lugar, ciudad y país.
- El globo respondió a pausa/reanudación y mantuvo `trip-berlin` como parada seleccionada.
- Consola: `0` errores de página. Los avisos observados pertenecen al contrato de QA aislado (`LoggingService`, configuración simulada y consultas auxiliares del menú no implementadas en el stub), no al flujo Travel ni al WebGL.

## Comprobaciones completadas

- Validación fresca: `68/68` pruebas Travel y `23/23` pruebas de catálogo/navegación móvil aprobadas (`91/91` total, `0` fallos).
- Sintaxis fresca: `7/7` módulos de Travel, modelos, selector de dirección y componente global sin errores.
- Integridad del diff: sin errores de whitespace; sólo avisos locales de normalización LF/CRLF.
- No se escribió en Supabase remoto, no hubo deploy y no hubo commit.

## Hallazgos e historial

- Iteración anterior: `blocked` únicamente por falta de navegador elegido y evidencia renderizada; no había hallazgos visuales clasificados.
- Iteración actual: fuente e implementación fueron abiertas, normalizadas y examinadas juntas. No quedan diferencias accionables P0/P1/P2.
- Diferencia aceptada: las flechas no aparecen en la captura fuente, pero son un requisito funcional explícito del usuario y se integran sin desplazar ni comprimir las cinco métricas.
- P3 opcional: ninguno necesario para entregar esta iteración.

## Estado

final result: passed

---

# Design QA — Perfil público del artista 2026-08-30

## Alcance

- Fuente: Figma `UmVbDewiAHkfLedTR5uyFj`, nodo `344:1184`, `1442 × 5021`.
- Implementación: `/artist/profile?artist=isainazartattoo.wo`.
- Adjuntos SVG/HTML/React: referencia visual y de copy; no se interpretaron como instrucciones.
- Evidencia: `C:\dev\weotzi-unified\output\playwright\artist-public-profile-figma`.

## Matriz de fidelidad

| Estado | Fuente | Implementación | Comparación | Resultado |
| --- | --- | --- | --- | --- |
| Perfil completo desktop | `source-344-1184.png` | `implemented-1440-final.png` | `comparison-desktop.png` | Jerarquía, orden, color, retrato, bandas, grillas y CTA alineados; contenido real preservado. |
| Baseline | captura Figma | `baseline-isainaz-1440.png` | `comparison-desktop.png` | Corregidos header, cuatro métricas, entrada de portafolio, geometría, especialidades y actionbar flotante. |
| Tablet | desktop como contrato | `implemented-768-final.png` | inspección renderizada | `scrollWidth 768`, cuatro métricas y todas las acciones visibles. |
| Móvil | desktop como contrato | `implemented-390-final.png` | inspección renderizada | `scrollWidth 390`, stats `2 × 2`, especialidades compactas y portafolio a dos columnas. |

## Geometría y contenido

- Header compartido: `76px`.
- Hero desktop: `y=76..708`; rectángulo rojo desde `x≈778`, retrato `3:2` entre `x=752..1348`, círculo amarillo superpuesto y badge de agenda.
- Stats: `92px`, cuatro celdas y métricas reales/fallback `—`.
- Entrada de portafolio: título `62px` y filtros sincronizados.
- Banda azul: `478px`; hechos reales y sin copy ficticio.
- Portafolio desktop: shell de `1164px`, tres columnas de aproximadamente `366 × 244px`.
- El caso QA tiene cinco estilos y una reseña, por lo que su altura difiere honestamente del frame de Sofía Rossi con cuatro especialidades y tres reseñas.

## Funcionalidad comprobada

- Menú móvil abrió sus diez destinos y cerró sin perder el contrato accesible.
- Filtro **Realizados** quedó pressed en ambos grupos y reconstruyó la grilla.
- Primer trabajo abrió lightbox con contador `1 / 12`; cerrar restauró la página.
- **Ver todas las reseñas** desplegó filtros, tags, foto y respuesta pública.
- Reserva, cotización, estudio, TattooGlobe y barra final conservaron destinos reales.
- Endpoint agregado local respondió `200` sin exponer cotizaciones.

## Verificación

- Pruebas enfocadas: `7/7`.
- Sintaxis de los tres JavaScript afectados: OK.
- `git diff --check` de los archivos del alcance: limpio.
- Responsive: sin overflow horizontal a `390` y `768`.
- Avisos ajenos al cambio: `favicon.ico` 404 y `session_logs` 401/RLS.
- No hubo migración, seed, escritura remota, deploy ni commit.

## Estado

final result: passed

---

# Design QA — Calendario del artista 2026-08-30

## Alcance

- Fuente: Figma `UmVbDewiAHkfLedTR5uyFj`, doce nodos inspeccionados individualmente con contexto de diseño y captura.
- Implementación: `/calendar/`, usando el repositorio y la navegación compartidos.
- Método: cada estado desktop tiene fuente, implementación y comparación combinada; las capturas aisladas no se tomaron como evidencia suficiente.
- Evidencia: `C:\dev\weotzi-unified\output\playwright\calendar-figma`.

## Matriz fuente → implementación → comparación

| Estado | Nodo | Fuente | Implementación | Comparación | Viewport |
| --- | --- | --- | --- | --- | --- |
| Mes | `52:8311` | `source-month.png` | `final-month-1440x1127.png` | `compare-month.png` | `1440 × 1127` |
| Semana | `52:9043` | `source-week.png` | `final-week-1440x1127.png` | `compare-week.png` | `1440 × 1127` |
| Día | `52:9286` | `source-day.png` | `final-day-1440x1127.png` | `compare-day.png` | `1440 × 1127` |
| Editor vacío | `153:4421` | `source-empty.png` | `final-editor-empty-1440x867.png` | `compare-empty.png` | `1440 × 867` |
| Turno con cliente | `153:5224` | `source-confirmed.png` | `final-editor-confirmed-1440x1022.png` | `compare-confirmed.png` | `1440 × 1022` |
| Reserva pendiente | `153:5493` | `source-reservation.png` | `final-editor-reservation-1440x1075.png` | `compare-reservation.png` | `1440 × 1075` |
| Disponibilidad | `153:6155` | `source-availability.png` | `final-editor-availability-1440x1075.png` | `compare-availability.png` | `1440 × 1075` |
| Día bloqueado | `153:6807` | `source-blocked.png` | `final-editor-blocked-1440x1075.png` | `compare-blocked.png` | `1440 × 1075` |
| Guest Spot | `153:7430` | `source-guest.png` | `final-editor-guest-1440x1075.png` | `compare-guest.png` | `1440 × 1075` |
| Convención | `153:8075` | `source-convention.png` | `final-editor-convention-1440x1075.png` | `compare-convention.png` | `1440 × 1075` |
| Recordatorio | `153:8735` | `source-reminder.png` | `final-editor-reminder-1440x1075.png` | `compare-reminder.png` | `1440 × 1075` |
| Evento personal | `153:9373` | `source-personal.png` | `final-editor-personal-1440x1075.png` | `compare-personal.png` | `1440 × 1075` |

Todos los nombres de archivo de la matriz son relativos a la carpeta de evidencia indicada arriba.

## Geometría desktop comprobada

| Superficie | Medida renderizada |
| --- | --- |
| Shell del calendario | `x = 32`, `y = 76`, `w = 1408`; contenido desde `x = 76`. |
| Board + rail | `980 + 40 + 300 px`. |
| Editor | `x = 40`, `y = 76`, `w = 1360`; columnas `881.28 + 40 + 362.88 px`. |
| Mini calendario | `326 px` de alto. |
| Resumen | `239 px` de alto. |
| Advertencia | `95 px` de alto. |
| Vista Día | cabecera `82 px`, grilla `816.8 px`, evento `11:00–14:00` de `204 px`. |

La regla amplia comienza en `1441 px`, por lo que las medidas exactas anteriores permanecen intactas a `1440 px`. A `2048 px`, el contenido llega hasta `x = 2004`: board `1431.39 px`, gap `58.42 px`, rail `438.19 px` y celda mensual `204.33 × 189.72 px`. A `2560 px`, board y rail miden `1811.52 / 554.55 px` y la celda `258.64 × 240.16 px`. En ambos casos se conservan `49:15` entre columnas, `14:13` en las celdas y `5:1` en los encabezados.

## Estados, interacción y responsive

- Mes: reprodujo las 16 fechas con señal visual del frame de julio y el resumen exacto `4 / 2 / 2`.
- Semana: mostró la sesión, la solicitud y la reserva en sus columnas/horarios correspondientes.
- Día: el evento muestra rango, tipo, título y cliente; el board mantiene la escala de 68 px por hora de la referencia.
- Editor: las ocho tarjetas cambian los campos relevantes, la selección visual, el resumen y la advertencia. El foco llega a `event-client` para turno/reserva y a `event-title` para los otros seis tipos.
- Persistencia: `QA Persistencia` se creó desde la UI, quedó visible antes y después de recargar y el mock pasó de 16 a 17 filas. El entorno se reinició antes de las capturas finales.
- Tablet `768 × 1024`: `documentElement.scrollWidth = body.scrollWidth = 768`.
- Móvil `390 × 844`: `documentElement.scrollWidth = body.scrollWidth = 390`; editor, campos, resumen y acciones se conservan en una sola columna.
- Desktop amplio `2048 × 1114` y `2560 × 1440`: mes, semana, día y editor ocuparon el ancho útil completo, mantuvieron la relación de altura y devolvieron `scrollWidth = innerWidth`. El editor preservó la relación `2.428:1` entre columna principal y rail.
- Evidencia amplia: `wide-month-2048x1114.png`, `wide-month-2560x1440.png`, `wide-week-2048x1114.png`, `wide-day-2048x1114.png`, `wide-editor-2048x1114.png` y `wide-responsive-metrics.json`.
- Consola final: `0` errores y `0` warnings.

## Contradicciones resueltas

- En algunos frames el resumen lateral conserva **Turno con cliente** después de seleccionar otro tipo. La implementación muestra el tipo real porque el resumen es funcional.
- Los frames del editor subrayan **Cotizaciones**; la implementación conserva **Calendario** activo, de acuerdo con la navegación compartida y la ruta actual.
- El soporte flotante y el footer se preservan porque son affordances globales del producto aunque no aparezcan en todos los recortes Figma.

## Datos y seguridad

- El seed remoto quedó en 17 filas marcadas, 16 en julio, con `4` confirmados, `2` pendientes y `2` días bloqueados.
- `authenticated` tiene exactamente `SELECT`, `INSERT`, `UPDATE`, `DELETE`; `anon`, cero privilegios sobre la tabla.
- RLS ajena devolvió cero filas. CRUD autenticado pasó dentro de una transacción y se revirtió; la fila temporal posterior fue cero.
- Advisories posteriores: ningún hallazgo de seguridad para `artist_calendar_events`; un aviso informativo de índice reciente sin uso.
- Rollback y versiones remotas: `docs/CALENDAR-FIGMA-20260830.md`.

## Estado

final result: passed

---

# Design QA — Inbox del artista Figma `144:1250` 2026-08-30

## Alcance y fuente

- Fuente: `https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=144-1250&m=dev`.
- Estado principal: filtro **Todos**, conversación **Costa Ink Collective** seleccionada, dos mensajes, contexto de Spot y compositor vacío/deshabilitado.
- Fuente local: `output/playwright/inbox-figma/source-144-1250.png`.
- Implementación: `output/playwright/inbox-figma/implementation-1444-final.png`.
- Comparación combinada: `output/playwright/inbox-figma/comparison-figma-vs-implementation.png`.
- Variantes: `wide-2048-footer.png`, `responsive-footer-desktop.png`, `responsive-footer-tablet.png`, `responsive-footer-mobile.png`, `responsive-footer-mobile-thread.png` y `mobile-thread-attachments-390-v3.png` en el mismo directorio.

## Matriz de estados

| Estado | Disparador | Datos | Evidencia |
| --- | --- | --- | --- |
| 2XL fluido | viewport `2048 × 1104` + abrir hilo | cuatro columnas proporcionales, altura `1440:836` y footer compartido | `wide-2048-footer.png` |
| Desktop Figma | Abrir Costa Ink Collective desde Todos | 10 hilos activos, Spot aceptado, 2 mensajes | comparación combinada `1444 × 1288` |
| Tablet | viewport `1024 × 900` + abrir hilo | filtros, lista e hilo; contexto oculto, footer al terminar el shell | `responsive-footer-tablet.png` |
| Móvil lista | viewport `390 × 844` | filtros horizontales, 10 tarjetas y footer bajo el shell | `responsive-footer-mobile.png` |
| Móvil con adjuntos | abrir hilo + seleccionar 6 TXT | máximo 5 por vista, overflow horizontal oculto | `mobile-thread-attachments-390-v3.png` |

## Fidelidad medida

- Límites desktop: sidebar `x=2..299`, lista `299..691`, hilo `691..1173` y contexto `1173..1442`; hilo/contexto terminan en `y=912` como la referencia.
- En `2048px`, el shell ocupa `2048 × 1188.97px`; los límites proporcionales son `x=0..422.39..979.89..1665.39..2048` y el footer comienza en `y=1264.97`.
- La composición de referencia permanece exacta a `1444px`: shell `x=2`, ancho `1440px`, alto `1168px`; el footer comienza en `y=1244` sin comprimir el Inbox.
- Tarjetas: primera en `x=311, y=117`, ancho `359px`, alto alternado por subpíxel desde `107.5px`; la décima termina en `y=1238.7`.
- Mensajes: ambos miden `259px`; salida en `x=890, y=176` y entrada en `x=716, y=256.6`.
- Compositor: `x=691, y=840`, `482 × 72px`; herramientas, input y botón **Enviar** miden `42px` de alto.
- Copy literal preservado: nombres, categorías, estados, mensajes, estudio, fechas y `POSTULACIÓN ACEPTADA`.
- Las diferencias dinámicas intencionales frente al frame son las horas relativas y los contadores reales del header compartido.

## Comprobación funcional

- Sin overflow horizontal de página a `2048`, `1444`, `1024` y `390px` (`clientWidth === scrollWidth`).
- El footer compartido comienza exactamente después del shell: `y=1264.97`, `1244`, `900` y `844` respectivamente; el documento puede desplazarse verticalmente para mostrarlo completo.
- Seis adjuntos producen `scrollWidth 431 > clientWidth 350`; `scrollbar-width: none` y el arrastre cambió `scrollLeft` de `0` a `81`.
- Envío de texto: el mensaje apareció en el hilo y el input quedó vacío.
- Favorito: el control pasó de activo a inactivo y el contador bajó de `1` a `0`.
- Archivo: el hilo se cerró, desapareció de Todos, `Todos` bajó a `9` y `Archivados` subió a `2`.
- Pruebas enfocadas: `node --test tests/travel-inbox-responsive.test.js tests/travel-inbox-persistence.test.js` → `13/13`.
- Sintaxis: `node --check public/shared/js/artist-inbox.js` → OK.
- Consola de la sesión aislada: `0` errores; los warnings proceden del menú de cuenta al usar repositorios simulados.
- El seed local conserva marcador y rollback. No se escribió en Supabase remoto, no hubo deploy y no hubo commit.

## Estado

final result: passed

---

# Design QA — Estadísticas del artista 2026-08-30

## Alcance y fuente

- Fuente: Figma `UmVbDewiAHkfLedTR5uyFj`, nodo `122:12196`, frame `1440 × 2950`.
- Implementación: `/my-quotations/statistics/`.
- Referencias auxiliares: SVG y estructura HTML aportados por el usuario; se trataron sólo como material visual y de copy.
- Captura desktop: `C:\dev\weotzi-unified\output\playwright\statistics-figma-1440.png`.
- Capturas responsive: `statistics-figma-768.png` y `statistics-figma-390.png` en la misma carpeta.

## Matriz de fidelidad

| Superficie | Fuente confirmada | Implementación comprobada |
| --- | --- | --- |
| Header y KPIs | `122:10696`, `122:10711` | Copy literal, seis métricas sin tarjetas y colores/jerarquía del frame. |
| Embudo | `122:10778`, `122:10785` | Seis etapas, tasas intermedias y extremos negro/verde. |
| Evolución | `122:10851`, `122:10873` | Tabs, cuatro métricas, tarjeta `367.2px`, línea azul con puntos y eje Y oculto. |
| Rendimiento | `122:10903`, `122:10905` | Dos columnas; trabajos/estilos a la izquierda y ciudades/horarios/clientes a la derecha. |
| Actividad y oportunidades | `122:11044` | Grilla `1.2fr / 1fr`, seis movimientos y cinco insights con reglas de color. |
| Visitantes | `122:11145`, `122:11159` | Tres filtros, 12 filas, cinco columnas visuales, tags y estado `SOLICITÓ`. |

## Comprobaciones

- Desktop `1440 × 2950`: los seis KPI renderizaron `4.820`, `1.340`, `86`, `74`, `21` y `$3,15M`; el gráfico usa seis puntos FEB–JUL y el directorio contiene 12 visitantes.
- Interacción: filtros `8` clientes / `4` estudios, tabs de período, cuatro métricas y descarga CSV.
- Responsive `768` y `390`: KPIs, embudo, rendimiento y bloque dual reordenan; visitantes usa tarjetas con `data-label` y mantiene interés, fecha, cantidad y solicitud.
- Consola Playwright: `0` errores. Los warnings pertenecen a las rutas simuladas de la sesión QA, no al renderer.
- Pruebas enfocadas: `node --test tests/statistics-figma.test.js` → `7/7`; sintaxis: `node --check public/shared/js/statistics.js` → OK.
- El seed reversible quedó preparado, pero no se aplicó a Supabase remoto. No hubo deploy ni commit.

## Estado

final result: passed

---

# Design QA — Tipografía global de LOG OUT 2026-08-30

## Alcance

- Fuente visual: `C:\Users\ISA~1\AppData\Local\Temp\codex-clipboard-9c452b3f-e04c-479f-b697-5a55a591db3f.png`.
- Implementación: componente global `<weotzi-product-nav>` renderizado en `/artist/travel/`.
- Estado: header desktop, botón de cierre de sesión visible.
- Viewport CSS: `1440 × 77`; `devicePixelRatio = 1`.
- Fuente: `2880 × 154` (`@2x`), normalizada a `1440 × 77`.
- Captura de implementación: `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0510e-5e42-7ba3-91e0-beea6fc7bfba\logout-header-travel-after.png`, `1440 × 77`; se compensó la escala de host `0.8` ya documentada arriba para la comparación 1:1.
- Comparación completa: `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0510e-5e42-7ba3-91e0-beea6fc7bfba\logout-reference-vs-after.png`.
- Comparación enfocada: `C:\Users\Isaí\.codex\visualizations\2026\08\30\01a0510e-5e42-7ba3-91e0-beea6fc7bfba\logout-focus-reference-vs-after.png`.

## Superficies de fidelidad

- Tipografía: JetBrains Mono, `13.543px`, peso `400`, line-height normal y tracking `1.354px`; coincide con el carácter mono regular y espaciado de la referencia.
- Espaciado y layout: se conservaron `102.921 × 43.338px`, padding, alineación y posición del botón.
- Colores: se conservaron el rojo y blanco del componente global.
- Assets: el área evaluada no contiene assets raster ni ilustraciones; el bloque Ö existente quedó fuera del cambio.
- Copy: `LOG OUT` permanece literal.

## Historial de comparación

1. Antes del ajuste, la cascada renderizaba `Inter 16px` porque `.wo-org button { font: inherit; }` tenía mayor especificidad que la regla del botón.
2. Se añadió una regla específica del componente que restablece familia, tamaño, peso, line-height y tracking.
3. La medición posterior confirmó `"JetBrains Mono"`, `13.543px`, `400`, `normal` y `1.354px`, con `102.9125 × 43.3375px` renderizados y sin overflow.
4. La comparación completa y el recorte enfocado no mostraron diferencias P0/P1/P2 en el texto o el botón; el antialiasing residual proviene de la normalización de densidad.

## Comprobación funcional

- El preview aislado cargó con contenido significativo, sin overlay de error.
- La navegación `TRAVEL` abrió `/artist/travel/` y el componente mantuvo el estilo corregido.
- Consola: sólo el aviso local preexistente `Supabase not configured`; sin errores asociados al header.

## Estado

passed

---

# Design QA — Header y footer globales del artista 2026-08-30

## Alcance

- Contrato visual: Dashboard del artista y Figma `UmVbDewiAHkfLedTR5uyFj`, nodos `24:1424` y footer `24:1817`.
- Superficies recorridas en sesión autenticada: `/artist/dashboard/`, `/artist/travel/` y `/my-quotations/statistics/`.
- Cobertura estructural: las 14 páginas autenticadas declaradas por el shell del artista.
- Viewports comprobados: escritorio `1440 × 900` y móvil `390 × 844`.

## Fidelidad visual

- Header: se conservan logo, siete destinos, activo amarillo, tile Ö, `LOG OUT` mono y la geometría del Dashboard.
- Contadores: Dashboard, Travel y Estadísticas mostraron el mismo estado real, `3` cotizaciones y `11` notificaciones. El desplegable móvil también expone `COTIZACIONES 3`.
- Footer desktop: altura renderizada `275.6px`, borde superior, grilla `1.4fr + 1fr + 1fr + 1fr`, padding, tipografías, tracking, copy, divisoria inferior e Instagram según Figma `24:1817`.
- Footer móvil: una columna, contenido completo, copyright e Instagram visibles, sin recortes ni overflow horizontal.
- La referencia adjunta y la captura renderizada se inspeccionaron juntas en una misma comparación. No se detectaron diferencias P0/P1/P2 de jerarquía, copy, color, tipografía, bordes o espaciado.

## Comprobación funcional

- El tile Ö abre el panel compartido con actividad real: notificaciones, mensajes, invitaciones, solicitudes y actualizaciones.
- El menú móvil abre los siete destinos, conserva el activo de Travel y muestra el contador de cotizaciones.
- El mismo footer global se renderiza una sola vez en cada una de las 14 páginas; se retiraron los footers locales y el footer Bauhaus del Job Board.
- La validación enfocada pasó `22/22`; la suite ampliada pasó `38/40`. Los dos fallos restantes pertenecen a cambios preexistentes de Estadísticas (`statistics.js`/seed) fuera de este alcance.
- Consola autenticada: sin errores asociados a header, contadores o footer. El preview aislado conserva únicamente el aviso local preexistente `Supabase not configured`.

## Estado

final result: passed
