# Dashboard Figma y datos demo de ISAINAZARTATTOO.WO

Fecha: 2026-08-29  
Proyecto Supabase: `flbgmlvfiejfttlawnfu` (`We Otzi App - Beta`)  
Artista: `isainazartattoo.wo` / `ISAINAZARTATTOO.WO`  
Referencia: [Figma “Pantallas We Otzi”, nodo 24:1424](https://www.figma.com/design/UmVbDewiAHkfLedTR5uyFj/Pantallas--We-Otzi?node-id=24-1424&m=dev)

## Alcance visual

El Dashboard conserva sus flujos reales y adopta la composición del nodo de Figma:

- hero editorial y agenda de cuatro turnos;
- tres diseños en proceso con imagen, etapa, progreso y fecha límite;
- cotizaciones `3 pendientes / 8 aprobadas / 1 rechazada`;
- actividad reciente, perfil, ingresos, recordatorios y acciones rápidas;
- galería de trabajos con cinco piezas visibles en la vista previa, CTA dentro del escenario oscuro y las 12 piezas reales conservadas en el perfil;
- footer lineal y adaptación responsive sin desborde horizontal.

La selección demo se activa únicamente cuando `artists_db.dashboard_config.dashboard_demo_marker` contiene `[PRUEBA][DASHBOARD-ISAINAZ-20260829]`; no altera el Dashboard de otros artistas.

## Datos aplicados

Fuente reproducible e idempotente: `supabase/seeds/20260829_isainaz_dashboard_demo.sql`.

El seed usa IDs/natural keys estables y reutiliza imágenes existentes del bucket público `artist-gallery`; no duplica archivos ni elimina la galería existente. Estado verificado después de aplicarlo:

| Área | Estado demo confirmado |
| --- | --- |
| Cotizaciones | 13 filas `DEMO-*`; el KPI muestra 3 pendientes, 8 aprobadas y 1 rechazada, mientras 1 `artist_completed` queda como diseño activo fuera de esos tres contadores |
| Imágenes de cotización | 8 attachments; las tarjetas de diseños reutilizan imágenes reales de la galería |
| Agenda | 4 sesiones del día: 10:00, 13:30, 16:00 y 18:30 |
| Actividad y recordatorios | 4 eventos de actividad y 4 recordatorios |
| Notificaciones/cuenta | 15 totales; 3 mensajes sin leer, 1 invitación y 3 solicitudes pendientes visibles en el menú |
| Ingresos | `$4.820` del mes, `$1.240` de la semana y `$650` pendientes |
| Job Board | 2 solicitudes y 2 postulaciones del artista |
| Estudios/Spots | 1 invitación pendiente; 2 spots demo y postulaciones del artista |
| Viajes | 5 viajes; checklist, 3 eventos de Barcelona y 1 vínculo a estudio |
| Galería | 12 medios/fuentes existentes preservados; cinco se muestran en el preview del Dashboard |
| Reseñas | 1 reseña verificada pública de 5 estrellas vinculada a una cotización completada |

## Cambios de base de datos

Se aplicaron tres migraciones necesarias para que la sesión autenticada pudiera leer/escribir los datos sin errores de políticas:

1. `20260829034500_fix_job_spot_rls_recursion.sql`: corta la recursión entre las policies de solicitudes y postulaciones.
2. `20260829035000_harden_rls_applicant_helpers.sql`: mueve los helpers a `private`, obtiene `auth.uid()` internamente y elimina las funciones públicas que aceptaban un usuario arbitrario.
3. `20260829035500_fix_session_logs_owner_policies.sql`: limita inserción, lectura y actualización de `session_logs` a la fila propia del usuario autenticado, manteniendo el alta anónima sólo con `user_id IS NULL`.

Verificación SQL final: sólo existen `private.is_job_board_request_applicant(uuid)` y `private.is_studio_spot_applicant(uuid)`; las policies públicas apuntan a esos helpers privados. Los avisos de seguridad históricos del proyecto no relacionados con estas migraciones quedaron fuera de alcance.

## Validación realizada

- `node --check` sobre los JavaScript modificados: correcto.
- `node --test tests/dashboard-figma.test.js tests/artist-auth.test.js`: 12/12 pruebas correctas.
- QA autenticada en `1440×900` y `390×844`: datos/copys esperados, menú de notificaciones operativo y sin desborde horizontal.
- Consola durante ambas revisiones: 0 errores y 1 warning preexistente de Google Maps sobre `google.maps.places.Autocomplete`.
- Capturas: `output/playwright/dashboard-figma-final-1440.png` y `output/playwright/dashboard-figma-final-390.png`.

No se ejecutó la suite completa ni se hizo deploy. No se creó ningún commit.

## Reversión

El bloque final comentado de `supabase/seeds/20260829_isainaz_dashboard_demo.sql` contiene el rollback manual y acotado por marker, IDs `DEMO-*`, request codes, textos demo y claves naturales de viaje. La reversión elimina sólo los registros de esta entrega y retira las claves demo de `dashboard_config`/`app_settings`; conserva la galería real del artista y las preferencias genéricas no pertenecientes al demo.
