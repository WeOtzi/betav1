# Área oportunidades · Figma final (oct 2026)

Job Board del artista (`/job-board`), Postulaciones (`/artist/applications`) y Spots (`/studio-spots`). Las 11 pantallas/estados del Figma quedaron rediseñados y funcionando en el preview con datos ficticios. La instancia 2007:5811 es la misma vista que 801:1070.

## Qué cambió

**Job Board** (801:1067 · 801:1068 · 801:1069)
- Cabecera con "Mis postulaciones →". El sponsor sigue el frame 103:1666: franja amarilla, titular Inter 23px, separador debajo. Los rieles ya no llevan una regla entre ellos y "Ver todo" aparece siempre. La card tiene un placeholder circular con esquinas arriba a la izquierda y abajo a la derecha. Los presupuestos van sin "USD".
- "Recomendado" ya no arranca activo: ahora funciona como filtro, igual que "Cerca tuyo", "Recién publicados" (ícono zap) y "Guardados".
- Detalle: chips del frame, requisitos específicos desde la columna nueva `specific_requirements`, valores en negrita con íconos, nota de contacto del cliente a la derecha y barra de propuestas recibidas. El aside tiene bordes en tinta, sin asteriscos, con ícono de calendario y la vista previa "Así te va a ver el cliente". Si ya te postulaste, el aside muestra el estado y "Ver seguimiento →".
- Confirmación: deep link `?solicitud=<código>&estado=enviada`.

**Postulaciones** (801:1070 · 801:1071 · 801:1073 · 801:1074 · 801:1075)
- Fixtures con las 9 postulaciones del Figma en todos los estados. La pestaña Job Board usa la variante 01: acciones como enlaces de texto y columnas más anchas.
- Copy literal: "El cliente propuso cambios", "El estudio envió una contraoferta", "Tiempo estimado de respuesta". Las etiquetas de beneficio salen de `benefit_tags` y el timeline dice "Nuevas fechas… Split ajustado a N%".
- "Ver conversación" sigue el contrato del Inbox (`?opportunity=&application=`) y abre el hilo ligado a la postulación.

**Spots** (801:537 · 801:538 · 801:539)
- Cabecera nueva:
  - título y pestañas: Explorar spots · Mis postulaciones · Invitaciones · N con punto rojo
  - búsqueda
  - filtros País / Ciudad / Fecha / Tipo de spot / Más filtros (alojamiento, stipend, mis estilos)
  - contador y orden
- El mosaico tiene 13 spots: ficha urgente, ficha itinerante en mono, promovido amarillo y una cinta con los spots que no entraron. Con filtros activos el mosaico pasa a una grilla parcial.
- En el detalle, la tarjeta de portfolio queda como en el Figma. Si ya te postulaste, el aside muestra el estado.
- Confirmación: deep link `?spot=<id>&estado=enviada`.

## URLs de estado (QA)

| Frame | URL |
| --- | --- |
| 801:1067 | `/job-board/` |
| 801:1068 | `/job-board/?solicitud=JB-45210` |
| 801:1069 | `/job-board/?solicitud=JB-24872&estado=enviada` |
| 801:1070 | `/artist/applications/` |
| 801:1071 | `/artist/applications/?tab=jobboard` |
| 801:1073 | `/artist/applications/?type=jobboard&id=0000c0de-0000-4000-8000-fa2000000002&from=todas` |
| 801:1075 | `/artist/applications/?tab=spots` |
| 801:1074 | `/artist/applications/?type=spot&id=0000c0de-0000-4000-8000-fb4000000001&from=spots` |
| 801:537 | `/studio-spots/` |
| 801:538 | `/studio-spots/?spot=0000c0de-0000-4000-8000-fb3000000006` |
| 801:539 | `/studio-spots/?spot=0000c0de-0000-4000-8000-b10000000003&estado=enviada` |

Capturas finales en `output/figma-final-artista/shots/oportunidades/<nodo>.png`.

## Backend (no aplicado)

- `supabase/migrations/20261028170000_oportunidades_figma_final.sql`, con su reversa en `supabase/rollbacks/`. Agrega:
  - `job_board_requests.specific_requirements`
  - `studio_spots.benefit_tags`
  - `studio_spots.availability_summary`
- Es aditiva e idempotente, con checks de largo y RLS reafirmada.
- Repo nuevo `WeotziData.SpotsOpportunities` (`spots-opportunities-repo.js`). Lee las columnas nuevas y, si la migración no está aplicada, vuelve al select anterior; también cuenta las invitaciones pendientes.

## Quitado de las páginas

- Estado activo por defecto de "Recomendado".
- Regla entre rieles.
- Asteriscos y línea con candado en el detalle del Job Board.
- Requisito "Fechas flexibles: true".
- Fila "Disponibilidad" en "Mi propuesta".
- Mini-avatar del cliente en el seguimiento.
- Ítems autogenerados de "Qué incluye".
- Texto de ayuda fijo del calendario.

No hay rutas para eliminar.

## Pendientes

- **Media**:
  - El formulario de cliente `/job-board/request` debe cargar `specific_requirements`.
  - El panel del estudio debe editar `benefit_tags` y `availability_summary`.
- **Baja**:
  - Flag real de verificación de clientes: hoy el check usa `client_public_profiles.profile_completed_at`.
  - Hilo de Costa Ink duplicado en el Inbox del preview (lo liga `travel-inbox.js` como "Postulación aceptada"); lo resuelve el área travel-inbox.
  - Puntos del calendario de spots (no está definido qué representan).

## Notas

- **Desfasaje de datos del mockup**: "Retrato realista de abuela" figura En revisión en el listado y con contraoferta en el detalle. Las fixtures siguen el detalle.
- **"¡Solicitud enviada con éxito!"** quedó literal, aunque el DS prohíbe los signos de exclamación. La decisión de copy queda pendiente.
- **Fixtures**:
  - Se reemplazaron las postulaciones base por las 9 del Figma.
  - Los spots base de La Aguja Negra y Zorro Rojo quedaron cerrados.
  - Costa Ink suma una sede en Barcelona.
  - Cada una de las 9 postulaciones tiene su hilo del Inbox ligado por `context_id`, con el estado del panel alineado.
- **Fixtures viejas en el navegador integrado**: el preview guarda el store en localStorage y carga las fixtures sin cache-busting. Para ver las nuevas hay que recargar y tocar "Reiniciar datos".
- **Topbar y footer** (área Dashboard): los frames no tienen footer ni "Modo cliente".
- **Tests** (después de la ronda 2): `node --test "tests/*.test.js"` da 620 tests: 616 pass, 3 fail y 1 skipped. Las 3 fallas son las de PowerShell 7 que ya fallaban. A 390 px no hay scroll horizontal (medido por CDP) y la consola no muestra errores.

## Corrección ronda 1 (auditoría independiente)

Se corrigieron los hallazgos de la auditoría dentro de los archivos del área. Las capturas nuevas reemplazan a las anteriores en `shots/oportunidades/`.

**P1**
- **Hero de Spots (801:537)**: ya no tiene alto fijo. Mide 396 px mínimo más una regla de 5 px en tinta, como el nodo 107:5088, y la columna "Foto del estudio" no se monta sobre el mosaico.
- **390 px en /studio-spots**: el buscador tiene `box-sizing: border-box` y no genera scroll horizontal (scrollWidth 390).
- **Estado de la postulación**: hay una sola derivación, en `public/shared/js/applications-state.js`. La usan Mis postulaciones, los asides "Ya te postulaste" de Job Board y Spots, y las confirmaciones con deep link. Una contraoferta pendiente se muestra como "Contraoferta recibida", con el botón "Responder contraoferta".

**Íconos y copy**
- Flecha Feather en "Ver solicitud", "Explorar…" y "Ver cotización".
- Maletín (briefcase) para el tipo de spot.
- external-link para el sitio del estudio.
- Estrella Feather en "Patrocinado" y en los ratings.
- Los placeholders ya no dicen "browse files": muestran ícono y etiqueta en castellano.
- El error de spot duplicado traduce el estado.
- El timeline no repite descripciones en "Cambio de estado".

**Estilos**
- Tarjetas del Job Board: borde de 1 px, presupuesto Bold 14 y botón 12 px, sin regla sobre la fila de precio.
- Rieles a sangre hasta el borde de la ventana; el sidebar ya no lleva divisores.
- Cabecera del detalle con los valores del Figma: título 36 px, breadcrumb claro, aviso solo con borde izquierdo.
- Resúmenes de confirmación: borde de 1 px, filas de 45 px con separadores insetados y encabezado claro.
- Listado de postulaciones con la tipografía del Figma: chips 12 px con borde de 1 px, contador "N de 9" y botones de 36 px.
- En la pestaña Job Board, las acciones terminan alineadas en el borde derecho.
- Stepper con cuadros de 40 px y etiquetas centradas; los conectores van en tinta hasta el paso activo.
- Aside "Seguimiento" con las medidas del Figma.
- Mosaico de Spots con las escalas tipográficas del Figma, marcas rotativas y una cinta de 56 px.

**Funcional y datos**
- "Postularme" en una solicitud ya postulada abre el detalle con el seguimiento.
- Nueva acción "Editar propuesta" mientras el cliente no vio la propuesta (`WeotziData.JobBoard.Applications.updateProposal`). URL de QA: `/artist/applications/?type=jobboard&id=0000c0de-0000-4000-8000-fa2000000001&editar=1`.
- Check de cliente verificado y rating del cliente: los datos salen de las reseñas de las fixtures.
- El portfolio enlaza a `/artist/profile?artist=<username>`. La tabla del BRIEF dice `?username=`, pero el parámetro real es `?artist=`.
- Las 9 postulaciones tienen su hilo en el Inbox.
- Las fechas sin hora se leen como día local; antes la fecha salía con un día menos.

**Desvíos que quedan**
- La pestaña Spots dice "Volver a spots"; el Figma dice "VOLVER AL JOB BOARD".
- "El cliente propuso cambios" se usa en lugar de "La clienta propuso cambios".
- Los enlaces de 801:1071 quedan dentro del contenedor; en el Figma se salen.

**Fuera del área**: la topbar (badges de COTIZACIONES y Ö) y el footer corresponden al área Dashboard.

## Corrección ronda 2 (auditoría independiente)

Se corrigieron los cuatro hallazgos P1. Las medidas se tomaron de `get_design_context` y se verificaron por CDP a 1440 px. Las capturas nuevas reemplazan a las anteriores en `shots/oportunidades/`. Quedan diferencias de 1 a 5 px en los altos totales, que vienen de los bordes: el Figma usa trazos de 1.6 px o internos y la implementación usa bordes de 1 px.

**Resúmenes de confirmación (801:1069 y 801:539)**
- Cabecera de 48 px: 14 px de padding más un badge de 20 px en Mono Bold 10.
- Cuerpo con 20 px de aire en los cuatro lados.
- Filas de unos 43 px; la del cliente o el estudio mide 57 px.
- El precio y el split van en Mono Bold 16.
- Botones de 52 px.
- Cajas resultantes: 278 px en Job Board (Figma 279) y 366 px en Spots (Figma 367).

**Aside "Seguimiento" (801:1073 y 801:1074)**
- Título de 22 px. La regla queda pegada a las filas: se quitó el hueco de 16 px.
- Ítems de la contraoferta de 36 px, separados 8 px.
- 20 px entre la caja de contraoferta y "Ver conversación".
- "Responder contraoferta" mide 48 px en Job Board y 41 px en Spot, como en cada frame. El aside del spot lleva la clase `apx-track--spot`.
- Altos: 659 px en Job Board (Figma 654) y 652 px en Spot (Figma 647).

**Detalle del Job Board (801:1068)**
- El título va en la caja de 680 px del Heading 1, con interlineado de 39.6 px. Corta "Retrato realista de abuela en / blanco y negro", con una primera línea de 574 px, igual que el Figma.
- Chips de 20 px.
- Aviso de plazo de 66 px.
- 93 px entre las filas de referencias.
- "La idea del tatuaje" queda a 13 px de las referencias y su texto también usa 680 px de ancho.
- El aside arranca a la altura del título.
- Las posiciones verticales quedan a ±2 px del Figma.

**Tarjetas del Job Board (801:1067)**
- Las tarjetas miden 296×437 (Figma 437.8).
- El cuerpo mide como mínimo 215 px, con gap de 10 px, y el pie queda anclado abajo: de la ciudad al precio hay 70 px.
- Etiquetas de 17.6 px, separadas 6 px.
- "Postularme" de 36 px.
- Además, el sidebar blanco y su borde llegan hasta el final del contenido, y el separador sobre "Refinar" va a sangre, en tinta.

Se sumaron 3 tests de la ronda 2 a `tests/figma-final-oportunidades.test.js`. A 390 px no hay scroll horizontal y la consola no muestra errores en las páginas tocadas.
