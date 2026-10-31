# Área perfil-estadisticas · Figma final (oct 2026)

## Frames

| Frame | Ruta | Resultado | Fidelidad |
| --- | --- | --- | --- |
| 801:1108 Perfil público - Artista y portafolio | `/artist/profile?artist=<username>` | rediseñada | alta |
| 801:543 Estadísticas - Actividad y conversión | `/my-quotations/statistics` | rediseñada | alta |

Capturas (ronda 1): `output/figma-final-artista/shots/perfil-estadisticas/801-1108.png` y `801-543.png`, más los estados `801-1108-resenas.png` (`&resenas=1`) y `801-543-ingresos.png` (`?metrica=ingresos`). Figma en `output/figma-final-artista/frames/`. 801:1155 (vista cliente) es idéntico a 801:1108: la misma página sirve a clientes y al artista.

**Estados por URL (QA):**
- Perfil: `?artist=valentina-preview.wo&estilo=blackwork` filtra el portafolio; `&resenas=1` abre todas las reseñas.
- Estadísticas: `?periodo=semana|mes|anio`, `&metrica=visitas|solicitudes|reservas|ingresos`, `&visitantes=todos|clientes|estudios`.

## Qué cambió

**Perfil público.** Ajusté la composición existente al frame final:
- Franja de estilos sin filete inferior.
- Entrada de portafolio de 138px, con chips de estilo en contorno ("Todo").
- Chips de la grilla: el activo en amarillo con sombra de 3px.
- Celdas vacías como slot punteado ("Foto de portafolio").
- Residencias con país en línea y los estados Agenda abierta, Lista de espera y Próximamente. Juntan `artist_tattoo_locations` con los viajes confirmados de Travel.
- Banda roja en grilla 1.3fr/1fr con chips de mes.
- Reseñas: el autor queda pegado a la cita y el enlace va subrayado.
- Barra de acción con la reserva en amarillo.

También corregí dos bugs:
- Los botones-enlace salían con texto azul porque `.wo-app a` le gana a `.wo-btn`.
- Las bandas se estiraban en ventanas altas.

**Estadísticas.**
- Main de 1280px con el contenido en la misma posición que en el frame.
- Ícono `external-link` en Exportar.
- Etiquetas de los KPI a 8px del número.
- Ingresos con el formato del Figma (`$3,15M`, `US$4.820`).
- Chips de métrica en mono, con el activo en amarillo y sombra.
- Eje del gráfico en mayúsculas.
- Actividad reciente con los textos del Figma: visita por Nª vez, solicitud con ciudad, cotización aceptada con monto, reserva con fecha, invitaciones, spots y job board. Horas en formato "Hace 1 hora" y "Ayer, 18:40".
- Oportunidades con los íconos del Figma.
- Tabla de visitantes con nombre y tipo en una línea, la ciudad debajo, "Hace 1 día" y el contador de visitas.
- El cliente Supabase ahora sale del singleton (espera `ConfigManager.ready`); la página ya no crea uno propio.

## Ronda 1 de corrección (auditoría independiente)

**Perfil público (801:1108)**
- **Panel Estudio (P1):** ahora muestra la fila de datos con ARTISTAS «6 residentes». Cuenta el roster activo más el propio artista. El bloque va centrado en vertical, como en el Figma: 16px hasta el nombre, 10 hasta la dirección, 26 hasta los datos y 30 hasta el enlace. La auditoría proponía anclarlo abajo, pero el frame lo centra.
- **Panel Estudio, detalles:** el enlace «Ver el estudio →» va en Mono 11 (+1.1px) con filete amarillo. El triángulo rojo mide 96px.
- **Reseñas (P1):** el autor va en dos líneas, con el nombre arriba y «PAÍS · AÑO» debajo.
- **Reseñas, avatares:** cuadrado · círculo · cuadrado (ink, rojo, azul `--blue-400`) con iniciales en Archivo Black 12. Las dos formas cumplen la regla 1 del DS.
- **Reseñas, círculo decorativo:** 150px, ink al 12%, con desfase −46/−36.
- **CTA del hero y de la banda roja:** 52px de alto, aire lateral de 29.6px, +1.12px y 8px hasta la flecha. Borde fino; el amarillo de la banda roja lleva borde `#24211d`.
- **Ficha «Sobre el artista»:** «5 años tatuando» y «$180 USD». Etiquetas en Mono 9 (+1.26px) y valores en SemiBold.
- **390px:** el nombre del hero ya no se corta a mitad de palabra (`clamp(40px, 13vw, 64px)`). Sigue sin scroll horizontal.
- **Widget «Ver todas las reseñas»** (`reviews.js`): todo el copy con acentos y voseo. Ejemplos: «Reputación pública», «3 reseñas», «1 estrella», «Calificación», «Contá cómo fue…».

**Estadísticas (801:543)**
- **KPI:** los seis números a 40px. Ingresos se compacta (`US$4,9K`, `$3,15M`) en lugar de achicar la letra, y las etiquetas quedan alineadas.
- **Tendencias:** flechas Feather de 12px. El ↖ de baja copia el mock.
- **Cabecera:** el eyebrow dice «ESTADÍSTICAS · Octubre 2026» (+1.44px) y el número de visitas al portfolio va en negro.
- **Embudo:** la tasa se topa en 100%, así que ya no aparece «131%».
- **Evolución:** el chip «Ingresos (miles)» grafica en miles y el titular y el tooltip muestran «US$3,8K». La línea mide 3px.
- **Rendimiento:**
  - Etiquetas en Mono Regular 11 (+1.1px).
  - Contador de trabajos en Mono 13 gris oscuro.
  - Horarios y Clientes en mitades iguales; «Clientes nuevos vs. recurrentes» entra en una línea.
  - Filas de 30px y ciudades con barra de 14px.
- **Oportunidades:** dicen lo que se mide: «X es el estilo más pedido en tus solicitudes» y «X es la ciudad que más te escribe».
- **Chart.js:** fijado en `4.4.1`.
- **390px:** Exportar queda debajo de la bajada y los KPI van en dos columnas.

**Recorrido guiado:** el portafolio es «filtrable por estilo» y el embudo va «hasta el trabajo realizado».

**Sin corregir:** el footer `<weotzi-product-footer>` y los contadores de la topbar. Son componentes compartidos de otras áreas y el BRIEF pide anotarlos sin tocarlos.

## Quitado en las páginas

- Fila de redes del hero (Instagram / TikTok / sitio web). El toggle `show_socials` de la cuenta ya no tiene efecto visible.
- Botón "Ver la galería completa →". La grilla ahora muestra todas las obras.
- Ilustración "Disponible · Slot libre" en las celdas vacías.
- La ubicación base sin fechas ya no aparece en "Próximas residencias".
- Las residencias futuras ya no aparecen en "Dónde tatué".
- Visitas anónimas en la actividad reciente (siguen contando en los KPI).

## Rutas a eliminar

- `/artist/visitors` → `/my-quotations/statistics`. Estadísticas ya cubre visitas, ciudades, horarios, visitantes identificados y actividad. Se pierden el mapa, el total de países y el feed en vivo, que no están en el diseño.
- `/artist/profile/gallery`: el perfil ya no la enlaza. Al redirigir hay que conservar `?artist=` hacia `/artist/profile` para los clientes. `/artist/account#portafolio` sirve solo para el propio artista.

## Backend (sin aplicar)

`supabase/migrations/20261028160000_artist_residency_country_waitlist.sql` (reversa en `supabase/rollbacks/`):
- Agrega la columna `country` a `artist_tattoo_locations`.
- Suma el estado `waitlist` a `agenda_status`.

El repo nuevo `WeotziData.ProfilePublic` (`public/shared/js/data/profile-public-repo.js`) reintenta la consulta sin `country` si la migración no está aplicada.

## Funciones faltantes

- **Media:** el editor de residencias (dashboard/cuenta) tiene que permitir cargar país y "Lista de espera".
- **Baja:**
  - El estudio no tiene los campos Ambiente y Accesos.
  - No hay dato de género para "Tatuadora" y "Verificada".
  - Las reseñas solo traen país, no ciudad.
  - "Dónde tatué" no puede usar los sellos del pasaporte (no tienen proyección pública).
  - El embudo no tiene una cohorte común. Cada etapa sale de su propia fuente, por eso la tasa se topa en 100%.
  - Las oportunidades «de crecimiento» y «de conversión» del Figma no se pueden calcular con los datos actuales.

## Tests

- **Suite completa:** 553 de 560 en verde. Las 6 fallas:
  - 3 de PowerShell 7 que ya fallaban antes.
  - 2 del área registro.
  - 1 de `base-path-routing` («fetch failed» bajo la carga de la suite; corrido solo pasa 3/3).
- **Área:** `tests/figma-final-perfil-estadisticas.test.js` pasa 17/17 (7 tests nuevos de la ronda 1). Con `statistics-figma`, `artist-public-*`, `verified-reviews-frontend` y `legacy-routes`, el total da 43/43.
- **Test actualizado:** en `tests/statistics-figma.test.js`, ingresos ya no usa `clamp`; va a 40px compacto.

## Notas para Isaí

- **Desvíos del Figma:**
  - En la barra de acción, "COTIZACIÓN" va en crema al 60%: en el Figma es `#24211d` sobre `#001125` y no se lee.
  - El Figma usa dos botones accent y una sombra en reposo; lo respeté aunque choca con las reglas 2 y 8 del DS.
- **Preview:** las fixtures del área interceptan tablas que el adaptador del preview reasigna, con el mismo patrón que `cuenta.js`. El pane comparte localStorage entre pestañas: un volcado viejo puede tapar las fixtures hasta usar "Reiniciar datos". Lo usé una vez durante la verificación.
- **A 390px** no hay scroll horizontal en ninguna de las dos páginas.
- **Ronda 1, avatares:** respeté el Figma, con formas mezcladas. Si preferís todos circulares, alcanza con quitar la clase `.is-round`.
- **Ronda 1, fixtures:** sumé 5 residentes activos a La Aguja Negra en `artists_db_roster_demo`, la tabla de roster de la extensión invitaciones. Puede cambiar el roster que muestra el área Invitaciones para ese estudio. La invitación pendiente del artista no se tocó.
- **Ronda 1, footer:** queda por decidir si el footer de producto sigue en el flujo del artista. Es un componente compartido y no lo toqué.
