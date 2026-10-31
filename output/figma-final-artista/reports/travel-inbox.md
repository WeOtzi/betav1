# Reporte · área travel-inbox (Figma final, oct 2026)

Rutas: `/artist/travel` (frames 801:1076–801:1084), `/artist/inbox` (801:1085) y el itinerario público `/travel/t/<slug>`.

## Qué cambió por frame

| Frame | Estado por URL | Resultado | Fidelidad |
| --- | --- | --- | --- |
| 801:1076 Mapa e itinerario | `/artist/travel/?parada=<trip_id>` (Madrid) | rediseñada | alta |
| 801:1077 Crear viaje | `/artist/travel/?modal=crear` | rediseñada | alta |
| 801:1078 Viaje agregado | `/artist/travel/?agregado=<trip_id>` | estado nuevo | alta |
| 801:1079 Detalle y checklist | `/artist/travel/?trip=<id>` | rediseñada | alta |
| 801:1080 Editar datos | `?trip=<id>&modal=editar` | rediseñada | alta |
| 801:1081 Vincular un estudio | `?trip=<id>&modal=vincular` | rediseñada | alta |
| 801:1082 Cambiar fechas | `?trip=<id>&modal=fechas` | rediseñada | exacta |
| 801:1083 Compartir itinerario | `?trip=<id>&modal=compartir` | rediseñada | alta |
| 801:1084 Confirmar cancelación | `?trip=<id>&modal=cancelar` | rediseñada | exacta |
| 801:1085 Inbox | `/artist/inbox/?thread=<id>` | rediseñada | alta |

Las capturas están en `output/figma-final-artista/shots/travel-inbox/<nodo>.png`. Ids de las fixtures: viaje a Barcelona `0000c0de-0000-4000-8000-e70000000001`, viaje a Madrid `0000c0de-0000-4000-8000-e70000000004`, hilo de Costa Ink `0000c0de-0000-4000-8000-a30000000001`.

## Ronda 2 de corrección (globo 801:1076)

- **Rutas finalizadas (P1)**: el globo se alimentaba solo con los próximos viajes, así que las finalizadas nunca se dibujaban. Ahora recibe todas las paradas de la vista filtrada desde `TravelDashboardModel.buildGlobeDestinations`: primero las próximas y después el historial, sin las canceladas. Con las fixtures son 8 paradas, igual que el contador "2 confirmados · 3 pendientes · 3 finalizados", y hay 3 rutas grises como en el Figma. La agenda resumida sigue mostrando solo las próximas. La geocodificación también incluye las paradas pasadas (`includePast`).
- **Medidas (P1)**: salen de los vectores del SVG del Figma (68:11939), no del PNG.
  - retícula de 1.96 px;
  - rutas de 2.94 px al 25 %: pendientes punteadas 9.6/7.7, confirmadas en tinta y finalizadas en `--neutral-300`;
  - paradas de Ø19.6 al 25 %;
  - parada seleccionada de Ø27.5, con ruta amarilla de 5.89 px punteada 9.7/7.8;
  - base de Ø23.5, pintada debajo de las rutas;
  - etiqueta en mono de 17.66 px.

  Medido en la captura: 27 px la parada seleccionada y 23 px la base. A 390 px los puntos se achican junto con el globo y no hay scroll horizontal.
- **Color de la base**: el Figma la pinta en `#FAF8F3`, que es `--neutral-100`, no en blanco. La auditoría partía de un dato equivocado, así que el color se mantiene. El "núcleo amarillo" es en realidad el primer medio trazo de la ruta seleccionada, que se pinta sobre la base: se implementó así y se quitó el círculo aparte.
- **Parada resaltada**: `?parada=<trip_id>` resalta esa parada en el globo y en la agenda. El frame resalta Madrid. Sin el parámetro se resalta la próxima parada (Barcelona); ninguna regla de producto lleva a Madrid. La parada que elige el artista (en la agenda, la cronología, el globo o por URL) se recuerda aunque un filtro la oculte.
- **Lo que no cambia**: las posiciones siguen la proyección real, así que no calcan la ilustración (Europa queda arriba a la derecha y Montevideo pegado a la base).

## Ronda 1 de corrección (auditoría independiente)

### Travel

- **Globo (P1)**: el componente `<weotzi-travel-globe>` tiene un modo nuevo, `mode="wireframe"`, que Travel usa por defecto. Es el globo del Figma:
  - líneas finas en `--neutral-400`;
  - rutas desde la base: pendientes punteadas tenues, finalizadas grises y confirmadas en tinta;
  - la parada seleccionada (por defecto, la próxima) con ruta punteada amarilla;
  - etiqueta "Tu base · Bs. As.", sin halo ni tooltip.

  Las paradas siguen siendo botones accesibles que abren el viaje. Sin ese atributo, el componente sigue siendo el globo COBE.
- **Vincular un estudio (P1)**: el foco del DS ya no tapa la lupa con el texto. El modal abre sin foco en el buscador, así que el campo se ve crema con borde de 1 px, como en el Figma.
- **Overlay (P1)**: el desplazamiento superior del overlay sale de la posición real de la nav (`--tvm-top`). Con la página scrolleada, el overlay cubre toda la pantalla y no quedan checkboxes clickeables.
- **URL pública (P1)**: se arma con el origen de la app más el prefijo de montaje, y se usa igual en el campo, en `mailto` y en `wa.me`. Antes apuntaba a `weotzi.com`, que da 404.
- **Desactivar enlace (P1)**: el viaje de Barcelona de las fixtures queda sin publicar, así que el estado del mockup muestra solo "Cerrar". El botón sigue existiendo cuando el itinerario es público; ver pendientes.
- **Layout del dashboard**:
  - contenedor de 1280 px (globo de 960 px) y cronología cortada al ancho;
  - tabs inactivas en `--neutral-300` y filete `--neutral-200`;
  - stats del hero alineados arriba, con los cortes de línea del Figma y un paso de 180 px;
  - el select "Todos los estados" se ve completo.
- **Modales**:
  - borde de 1 px sin sombra; solo "Crear viaje" lleva sombra dura;
  - botones secundarios con borde de 1 px;
  - "Cancelar viaje" en `--system-error` (#E42121);
  - las fechas no muestran el ícono nativo y ningún campo empieza enfocado;
  - placeholders en `--neutral-400` y notas sin grip de redimensión.
- **Tipografía**: los títulos de Travel usan `font-synthesis:none`, así Archivo Black ya no se ve con negrita falsa.
- **Viaje agregado**: la tarjeta tiene borde de 1 px, 20 px de aire, filas de 43 px con los divisores dentro del padding, y "Creado manualmente" en mono de 12 px.
- **Documentos**: Pasaje y Contrato usan el ícono `copy`; Reserva de hotel usa `home`.
- **Feedback**:
  - al pedir una vinculación aparece el aviso "Solicitud enviada a <estudio>" y la solicitud se lista en "Otras solicitudes de vinculación";
  - si falla editar, fechas, cancelar, vincular o compartir, el modal muestra el error;
  - si falla otra acción del detalle, aparece un aviso de error.

### Inbox

- **Enlace profundo**: la fila activa queda a la vista dentro de la lista.
- **Panel de contexto**: los enlaces respetan el prefijo de montaje (`/beta` o el preview).
- **Hilos de contacto con estudios** (`studio_contact`):
  - nuevo bloque "Motivo";
  - nuevo enlace "Ver perfil del estudio";
  - el nombre del estudio ya no repite la etiqueta "Estudio";
  - las rutas y URLs dentro de los mensajes son enlaces;
  - las iniciales solo usan letras ("GÒ", "VP").
- **Detalles de la lista**:
  - íconos del composer de 16 px en gris;
  - contador de no leídos circular, de 18 px;
  - filas del resumen cada 25 px;
  - horas con día de la semana ("lun", "vie", "ayer").
- **Fixtures coherentes con Postulaciones**:
  - Costa Ink pasa a "Residencia · Barcelona", con las fechas pedidas en la postulación y el mes del mensaje calculado a partir de ellas;
  - del hilo de Zorro Rojo se quitó la logística previa ("llego el 22"), y el mes del primer contacto sale de la ventana de guest del estudio;
  - el hilo huérfano de Aurora se reemplazó por un hilo por cada postulación de Job Board y de Spot, igual que hacen los triggers reales. "Ver conversación" abre siempre un hilo.

## Enlaces profundos

- **Inbox**:
  - `?thread=<id|clave|context_id>`;
  - `?quote=<quote_id>`;
  - `?opportunity=jobboard|spot&application=<id>`;
  - `?trip=<trip_id>`;
  - `?filter=<categoría>`.
- **Travel**:
  - `?modal=crear`;
  - `?agregado=<trip_id>`;
  - `?trip=<id>&modal=editar|fechas|vincular|compartir|cancelar|adjuntar`;
  - `?parada=<trip_id>` (parada resaltada en el globo y la agenda).

## Pendientes y decisiones

- **Media**: revocar un enlace público no está en el Figma. "Desactivar enlace" se mantiene solo con el itinerario ya publicado. Falta decidir si va al diseño.
- **Media**: el hilo "Soporte We Ötzi" sigue en "Todos". Si se excluye, las respuestas de soporte quedan inaccesibles. Lo decide producto.
- **Baja, área Dashboard**: la topbar muestra badges que el Figma no tiene, y el footer compartido difiere de los frames (banda oscura o ningún footer).
- **Baja**: el Inbox abre sin ninguna conversación seleccionada; el estado del frame se reproduce con `?thread=`.
- **Baja**: en el preview no se pueden abrir los PDF del bucket privado.
- **Baja**: Costa Ink figura como "Postulación aceptada" (literal del Figma), mientras que Postulaciones la lista como preseleccionada.

## Backend

No hizo falta backend nuevo ni migraciones. El itinerario público del preview usa ahora `/travel/t/montevideo-ink-society`. Captura: `shots/travel-inbox/travel-share-publico.png`.

## Tests

`node --test "tests/*.test.js"`: 606 tests, 602 pass y 3 fail. Los 3 fallos son los de PowerShell 7, que ya fallaban antes y no son del área.

El área pasa 84/84. Hay 1 test nuevo de la ronda 2 en `tests/figma-final-travel-inbox.test.js`, que cubre:

- `buildGlobeDestinations` y la geocodificación con `includePast`;
- las medidas del SVG y las rutas finalizadas;
- el escalado a 390 px y `?parada=`.
