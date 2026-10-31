# Área cotizaciones · Figma final del flujo de artista

## Qué quedó

| Frame | Ruta / estado | Resultado | Fidelidad |
| --- | --- | --- | --- |
| 801:555 Listado y prioridades | `/my-quotations/` | rediseñada | alta |
| 801:564 Resumen lateral de solicitud | `/my-quotations/?resumen=DEMO-P01` (tocar una fila) | estado nuevo | alta |
| 801:556 Nueva cotización manual (+ 2004:2968) | `/my-quotations/new/` (`?origen=cliente`, `?origen=cita&fecha=2026-11-03`, `?borrador=COT-DEMO01`, `?volver=/calendar/`) | ruta creada | alta |
| 801:557 Vista previa para el cliente | `/my-quotations/new/?step=preview` | estado nuevo | exacta |

Capturas en `output/figma-final-artista/shots/cotizaciones/`:
- `801-555.png` (ronda 1).
- `801-564.png`, `801-556.png` y `801-557.png` (rehechas en la ronda 2).
- `801-555-390.png`: captura en móvil.
- `estado-archivadas.png`: `/my-quotations/?alcance=archivadas&resumen=DEMO-A01`.

- **Listado**: hero, selectores, indicadores, búsqueda, chips, leyenda, tarjetas agrupadas y paginación como en el Figma.
  - Tocar una fila abre el resumen lateral; "Ver detalle" va a `/my-quotations/detail?id=<quote_id>`.
  - El selector "cotizaciones" suma **Borradores** y **Archivadas** (`?alcance=`).
- **Resumen lateral**: los selects de estado y prioridad guardan.
  - Aceptar, Rechazar, Agendar, Contactar y Ver detalle funcionan con las mismas reglas que el detalle.
  - En las archivadas, los botones son Desarchivar y Eliminar.
- **Nueva cotización manual**: buscador de clientes, alta en línea, campos del tatuaje, adjuntos, conceptos con chips rápidos, totales, condiciones, Guardar borrador, Previsualizar y Crear y enviar.
  - Crear y enviar genera la cotización real con el RPC `create_manual_quotation` y abre su resumen.

## Ronda 1 de correcciones (auditoría)
Corregido:
- **P1 · Hueco en el hero entre 390 y 900px**: `.q-hero-main` pasa a `flex: 0 0 auto` en columna. A 390px, los botones y "Mostrar en" quedan a 24px y no hay scroll horizontal.
- **P1 · Orden por presupuesto**: ahora sale una sola lista ordenada ("De mayor a menor presupuesto" o "De menor a mayor presupuesto").
  - Compara en la moneda de "Mostrar en" cuando hay tipo de cambio.
  - Sin tipo de cambio no mezcla monedas: primero la principal, después las demás y al final las que no tienen importe.
  - El orden por fecha conserva los grupos del Figma.
- **P1 · Chips de conceptos**: van debajo de AGREGAR CONCEPTO, en columna con gap de 12px y 2 filas (4 + 2) de hasta 580px.
- **Ingresos confirmados**: suma con el mismo criterio que el chip CONFIRMADAS. En el preview da US$6.010.
- **"Mostrar en"**: se quitó "Moneda original".
  - Por defecto toma la moneda de sesión del artista.
  - Si falta el tipo de cambio, los totales usan la moneda más frecuente en vez de "$0" o "Sin importe".
- **Volver al origen**: la hoja acepta `?fecha=AAAA-MM-DD` y `?volver=<ruta interna>`.
  - Sin `?volver=`, Cancelar y × vuelven a la página de We Ötzi de la que se vino (calendario, dashboard).
  - Después de "Crear y enviar" se queda en el listado.
- **Atrás del navegador**: con cambios sin guardar pide confirmación. Recargar o salir de la página muestra el aviso nativo.
- **Controles del formulario**:
  - Los selects no muestran chevron en reposo; aparece con hover o foco.
  - "Fecha tentativa" no muestra el ícono nativo y todo el campo abre el selector.
  - Las textareas no muestran el tirador en reposo.
  - El buscador recibe el foco al abrir pero sin anillo; el anillo aparece con la primera tecla o el primer clic.
  - El borde de los inputs se acerca a #c9c2b4.
  - El chip de moneda no muestra chevron en reposo, igual que en el Figma, que le reserva el lugar.
  - (La ronda 1 decía que la deriva vertical había bajado a 1px o menos. Era falso: ver ronda 2.)
- **Timeline del resumen**: sigue la estructura del nodo 99:828 (columna de 74px, el último tramo sin guion). Las medidas que se dieron eran falsas: ver ronda 2.
- **Leyenda y badges**: el listado usa las cinco familias del Figma ("Confirmada" para en progreso, lista y completada). El estado fino queda en:
  - el title del badge y el texto para lectores de pantalla;
  - el filtro "Estado";
  - el resumen lateral.

No corregido (con motivo):
- **Referencia correlativa "COT-059"**: `quote_ref` y `quote_id` son únicos en toda la base, así que un número por artista chocaría entre artistas. Necesita una secuencia por artista en el backend; queda como función faltante.
- **Link del calendario** (`public/shared/js/calendar.js`, área calendario): debe apuntar a `/my-quotations/new?origen=cita&fecha=AAAA-MM-DD` (y opcionalmente `&volver=`). La hoja ya lo soporta.
- **Footer global**: está en las 13 páginas del artista. Es una decisión transversal.
- **Badges de la topbar**: son del componente compartido (área Dashboard).

## Ronda 2 de correcciones (auditoría)
Medido con Chrome headless por CDP a 1440px y comparado con `get_metadata` del Figma.

- **P1 · 801:556, deriva vertical en 03, 04 y el pie**: antes había +5px desde 03, +13.6px desde 04 y +7.7px en los botones del pie. Ahora toda la hoja queda a 0.6px o menos del Figma.
  - La caja "Todavía no adjuntaste referencias" medía 67.1px y ahora mide 62px (Figma 61.6px): texto de 16px y sin aire inferior.
  - Los totales medían 471.7px y ahora miden 462.9px (Figma 463px):
    - filas de 36.4, 54.4, 54.4, 60, 59.4, 29.6 y 29.6px;
    - nota de 50px;
    - el cabezal ink a 1.6px del borde;
    - inputs de % de 83.6×35.6px.
  - En 04: 18.6px hasta "Notas para el cliente", 22px hasta "Términos adicionales" y labels de 13.6px.
  - El chip de moneda tiene ahora padding de 10.8/22.8px, como el Figma.
  - Posiciones medidas desde el borde superior de la hoja (Figma entre paréntesis):

    | Elemento | Implementación | Figma |
    | --- | --- | --- |
    | "03" | 1090.3 | 1090.4 |
    | Totales | 1118.6–1581.5 | 1118.8–1581.8 |
    | "04" | 1621.5 | 1621.8 |
    | Labels de condiciones | 1649.8 | 1650.2 |
    | "Notas" | 1733.4 | 1733.8 |
    | "Términos" | 1872.0 | 1872.6 |
    | Botones del pie | 2052.6 | 2053 |

- **P1 · 801:564, ancho del timeline**: medía 360px, con tramos de 90px y guion de 16px. Ahora las secciones posteriores al resumen del tatuaje miden 345.2px, como en el Figma 99:732.
  - Timeline de 345.2px, tramos de 86.3px y guion de 12.3px.
  - El último cuadrado queda a 304.9px del borde del panel, igual que en el Figma.
  - De paso, los tiles económicos quedan en 160/98/96px y la burbuja propia se alinea a 345.2px.
  - Debajo de 640px las secciones vuelven al ancho completo.
- **Extra en móvil**: la regla de 640px pisaba los tamaños de los montos largos y "US$350" se recortaba a 360–390px. Ahora usa 28px (22px los más largos) y entra. Verificado a 360, 375, 390 y 600px sin scroll horizontal.
- Diferencia que queda en 801:556: en horizontal, el Figma tiene una scrollbar de 15.6px dentro de la hoja (contenido de 908.8px). La captura headless oculta las scrollbars (contenido de 924px). Con la scrollbar clásica de Windows coincide.

## Quitado de la página
- "Configurar cotizador" y el link "Ver archivadas →".
- El ítem ARCHIVO del menú móvil.
- La vista oculta de postulaciones: `?tab=applications` ahora redirige a `/artist/applications`.
- El drawer viejo, con su modal de notas, Editor.js, html2pdf y lightbox.
- El filete superior de los indicadores y el borde del bloque "Mostrar en".
- La opción "Moneda original" (ronda 1).

## Rutas
El orquestador ya retiró `/archive` (→ `/my-quotations?alcance=archivadas`) y `/tutorial` (→ `/my-quotations?demo=1&tour=1`). No quedan links a esas rutas en los archivos del área.

## Backend (sin aplicar)
`supabase/migrations/20261028120000_quotation_manual_quotes.sql` (reversa en `supabase/rollbacks/…down.sql`):
- `artist_clients`: libreta de clientes del artista.
- `artist_manual_quotes`: borradores y desglose económico.
- RPC `create_manual_quotation`: es security definer.

Sin esta migración, la hoja guarda el borrador en el navegador y avisa.

## Funciones faltantes
- Archivar una cotización activa: no hay control en el Figma.
- Plantilla de correo propia para la cotización manual.
- Adjuntos en el preview: el preview no simula Storage.
- Numeración correlativa por artista.
- Que el área calendario cambie el link de "Crear cotización manual".

## Tests
- Ronda 2: `node --test "tests/*.test.js"`: 602 tests, 598 pasan, 3 fallan y 1 se saltea. Las 3 fallas son las preexistentes de PowerShell 7.
- `tests/figma-final-cotizaciones.test.js` pasa 26 de 26. Hay un test nuevo de la ronda 2 para el ancho del timeline, la caja de referencias, las filas de los totales, el chip de moneda y los márgenes de 04.
- Ronda 1: 560 tests, 555 pasan y 5 fallan. Ninguna falla es de esta área:
  - 3 son preexistentes de PowerShell 7.
  - 2 son del área registro, en curso.
- `base-path-routing` falló una vez de forma intermitente; pasa solo y en las corridas siguientes.
- `tests/figma-final-cotizaciones.test.js` pasa 25 de 25 (5 tests nuevos de la ronda 1).

## Notas
- `?volver=` solo acepta rutas internas. Rechaza `//`, `\`, esquemas y caracteres de control.
- "Mostrar en" guarda la elección en la preferencia global de moneda. Si el artista nunca eligió, usa su moneda de sesión sin escribir la preferencia.
- La captura headless a 390px sale recortada a la derecha. El responsive se verificó en el navegador integrado.
- Se subió el cache-busting de los CSS y JS del área a `?v=20261028-2`. En la ronda 2, `quotations.css` y `quotation-new.css` pasaron a `?v=20261028-3`.
- `quotations.css` también lo cargan estadísticas y soporte. Los cambios de la ronda 2 solo tocan las reglas `.qs-*` del resumen lateral.
- Los grises chicos del Figma no llegan a contraste AA; se mantuvieron por fidelidad.
