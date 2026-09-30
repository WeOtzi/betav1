# Calendario de artista — réplica Figma 2026-08-30

## Alcance

La ruta `/calendar/` replica los doce estados solicitados del archivo Figma `UmVbDewiAHkfLedTR5uyFj`: mes, semana, día, editor vacío y los ocho tipos de evento. La réplica mantiene el flujo compartido existente y no introduce una segunda experiencia paralela.

| Estado | Nodo Figma |
| --- | --- |
| Mes | `52:8311` |
| Semana | `52:9043` |
| Día | `52:9286` |
| Editor sin tipo | `153:4421` |
| Turno con cliente | `153:5224` |
| Reserva pendiente | `153:5493` |
| Disponibilidad | `153:6155` |
| Día bloqueado | `153:6807` |
| Guest Spot | `153:7430` |
| Convención | `153:8075` |
| Recordatorio | `153:8735` |
| Evento personal | `153:9373` |

## Comportamiento implementado

- Mes, semana, día y agenda comparten búsqueda, navegación temporal, leyenda y próximos eventos.
- El botón **Nuevo evento** abre el editor en la fecha seleccionada. Cada tipo muestra sólo sus campos pertinentes y el foco/caret pasa al primer campo editable.
- El resumen lateral reacciona al tipo, fecha, hora, duración y ubicación elegidos. La advertencia de superposición se recalcula mientras se edita.
- Crear, editar y eliminar usan `Calendar.create`, `Calendar.update` y `Calendar.remove`; la recarga vuelve a consultar el repositorio.
- Los eventos manuales viven únicamente en `artist_calendar_events`. Las sesiones de cotización y los viajes se proyectan desde sus tablas de origen, sin copiar registros ni producir duplicados.
- La validación de solapamientos se repite en servidor para los tipos que bloquean agenda. La recurrencia semanal se expande como proyección de lectura y conserva una sola fila persistida.

## Datos demo

El seed `supabase/seeds/20260829_isainaz_calendar_demo.sql` es idempotente y está acotado al artista `isainazartattoo.wo` mediante el marcador `[PRUEBA][CALENDAR-ISAINAZ-20260829]`.

El estado remoto aplicado contiene 17 filas marcadas. Dieciséis caen en julio de 2026 y reproducen el mural de referencia: cuatro turnos confirmados, dos solicitudes/reservas pendientes y dos días bloqueados, además de disponibilidad, Guest Spot, convención, recordatorio y evento personal. El recordatorio recurrente comienza en agosto para representar el noveno tipo sin agregar barras ajenas al frame de julio.

Rollback acotado de los datos demo:

```sql
delete from public.artist_calendar_events
where notes like '%[PRUEBA][CALENDAR-ISAINAZ-20260829]%';
```

## Supabase remoto

Proyecto: `flbgmlvfiejfttlawnfu`.

- La migración base local `20260829145232_artist_calendar_events.sql` figura remotamente como `20260829151656_artist_calendar_events`.
- El hardening local `20260830114500_lock_down_artist_calendar_privileges.sql` figura remotamente como `20260831013211_lock_down_artist_calendar_privileges`.
- El hardening revoca los privilegios implícitos y deja a `authenticated` únicamente `SELECT`, `INSERT`, `UPDATE` y `DELETE`; `anon` conserva cero privilegios de tabla.
- RLS permanece activa con cuatro políticas por propietario y la prueba bajo un usuario ajeno devolvió cero filas.
- Una prueba transaccional autenticada de alta, edición y baja terminó correctamente y luego ejecutó `ROLLBACK`; la consulta posterior confirmó cero filas temporales.
- Los advisories posteriores no reportaron hallazgos de seguridad para `artist_calendar_events`. El único resultado específico es informativo: `idx_artist_calendar_events_owner_recurring` todavía no registra uso, esperable para una tabla reciente. Los avisos sobre otras tablas son backlog preexistente y no se alteraron en este alcance.

El rollback de datos está diseñado para ser seguro y acotado. No se recomienda revertir el hardening de privilegios: restaurar `TRUNCATE`, `TRIGGER` o `REFERENCES` a usuarios autenticados ampliaría innecesariamente la superficie de ataque.

## Validación

- Comparación visual combinada para los doce estados en `output/playwright/calendar-figma/compare-*.png`.
- Capturas finales desktop: `1440 × 1127` para mes, semana y día; `1440 × 867` para el editor vacío; `1440 × 1022` para turno; `1440 × 1075` para los siete estados restantes.
- El frame Figma de `1440 px` conserva su geometría exacta. A partir de `1441 px`, el shell pasa a ser fluido: board y rail mantienen la relación `49:15`, el gap conserva el `3.030303%` y las celdas mensuales preservan la proporción `14:13` también en altura.
- Responsive comprobado a `2560 × 1440`, `2048 × 1114`, `1440 × 1127`, `768 × 1024` y `390 × 844`, sin overflow horizontal y sin pérdida de campos o acciones. La evidencia amplia está en `wide-month-*.png`, `wide-week-2048x1114.png`, `wide-day-2048x1114.png`, `wide-editor-2048x1114.png` y `wide-responsive-metrics.json`.
- Persistencia comprobada desde UI: se creó `QA Persistencia`, apareció antes de recargar y siguió presente después de recargar. El entorno mock se reinició antes de las capturas finales para conservar el estado Figma exacto.
- Geometría desktop medida: board mensual `980 px`, rail lateral `300 px`, gap `40 px`; editor `881.28 + 40 + 362.88 px`; cabecera de día `82 px`; evento de `11:00–14:00` a `204 px` de alto.
- Geometría amplia medida a `2048 px`: board `1431.39 px`, gap `58.42 px`, rail `438.19 px`; celda `204.33 × 189.72 px`; editor `1325.91 + 60.17 + 546.08 px`. A `2560 px`: board `1811.52 px`, rail `554.55 px` y celda `258.64 × 240.16 px`.
- Consola del navegador: cero errores y cero warnings durante la pasada final.

## Decisiones frente a contradicciones de la fuente

- El rail del editor muestra el tipo realmente seleccionado. Algunos frames de Figma conservan por error **Turno con cliente** al elegir otro tipo.
- La navegación compartida marca **Calendario** como sección activa. El subrayado bajo **Cotizaciones** en los frames del editor se trató como inconsistencia del prototipo.
- Se conservaron el soporte flotante, el footer y la navegación responsive existentes porque son affordances compartidos del producto.

No se realizó deploy ni commit.
