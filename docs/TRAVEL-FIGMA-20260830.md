# Travel — réplica Figma y contrato de datos

- Fecha: 2026-08-30
- Ruta autenticada: `/artist/travel/`
- Ruta pública canónica: `/travel/t/<slug>`
- Compatibilidad pública: `/travel/share?slug=<slug>`

## Alcance de diseño

La fuente de verdad es el archivo Figma `UmVbDewiAHkfLedTR5uyFj`. Se inspeccionaron e implementaron los nueve estados solicitados; las nueve capturas fuente son imágenes únicas, con SHA-256 distintos.

| Estado | Nodo |
| --- | --- |
| Dashboard Travel | `68:11882` |
| Crear viaje | `419:2487` |
| Viaje agregado | `131:14426` |
| Detalle | `132:14729` |
| Editar viaje | `173:24897` |
| Cambiar fechas | `173:25982` |
| Vincular un estudio | `173:26741` |
| Compartir itinerario | `173:27503` |
| Cancelar viaje | `173:28256` |

La implementación conserva la navegación compartida y el flujo existente. El dashboard reúne métricas, filtros, globo, agenda, cronología y Tattoo Passport. El mismo módulo resuelve alta, confirmación, detalle, edición, fechas, vínculo, compartir, cancelar/reactivar, checklist, documentos y eventos. En tablet y móvil el contenido se reordena sin ocultar cifras, documentos ni acciones.

## Cómo usar Travel

1. Abrí `/artist/travel/` con una sesión de artista.
2. Filtrá por estado o región y elegí un destino del globo, la agenda o la cronología para abrir su detalle.
3. Usá **Crear nuevo viaje**; la ciudad recibe foco automáticamente. Completá destino, fechas, tipo y notas para guardar.
4. En el detalle podés editar los datos, cambiar fechas, solicitar vínculo con un estudio, compartir o cancelar. Un viaje cancelado puede reactivarse si su estado lo permite.
5. Gestioná tareas, documentos y eventos desde el mismo detalle. Los documentos privados se almacenan bajo el bucket `artist-trip-docs`; al eliminar, primero se retira el metadato visible y después se limpia el objeto privado. Si esa limpieza secundaria falla queda un objeto privado reintentable, nunca una referencia activa a un archivo ausente.
6. Abrir **Compartir itinerario** no publica nada ni expone una URL inactiva. En un viaje todavía privado, el primer click en **Copiar** habilita el enlace y cambia el control a **Copiar ahora**; el segundo click lo copia conservando el gesto del navegador. **Email** y **WhatsApp** también lo habilitan explícitamente antes de abrir el destino. **Desactivar enlace** vuelve a revocarlo. Los enlaces anteriores `/travel/share?slug=<slug>` siguen resolviendo por compatibilidad.

La pantalla pública es de solo lectura y recibe únicamente el contrato permitido por el RPC; no expone notas personales, condiciones privadas, rutas de Storage ni identificadores internos ajenos al itinerario.

## Modelo de datos

Travel usa seis tablas de dominio:

| Tabla | Responsabilidad |
| --- | --- |
| `artist_trips` | Destino, región, fechas, tipo, estado, interés, clima, notas y configuración de compartir. |
| `trip_studio_links` | Solicitud y resolución de vínculo con estudio, más instantáneas de contacto y dirección. |
| `trip_checklist_items` | Tareas ordenadas del viaje. |
| `trip_documents` | Metadatos y ruta privada de documentos. |
| `trip_events` | Cronología persistida del viaje. |
| `artist_travel_passport_stamps` | Sellos históricos de Tattoo Passport separados de los viajes activos. |

El bucket privado `artist-trip-docs` guarda los archivos. La aplicación usa `public/shared/js/data/travel-repo.js` como acceso de dominio, `public/shared/js/artist-travel.js` para el workspace autenticado y `public/shared/js/travel-share.js` para la vista pública.

## Migración y seguridad

Las tres migraciones de esta entrega fueron aplicadas al proyecto Supabase `flbgmlvfiejfttlawnfu`:

| Archivo local | Historial remoto confirmado | Alcance |
| --- | --- | --- |
| `20260830013000_secure_travel_data_contract.sql` | `20260830072129 secure_travel_data_contract`; sus dos correcciones ya incorporadas en el archivo local figuran como `20260830073147 ensure_travel_studio_link_source_uniqueness` y `20260830073348 revoke_anonymous_travel_satellite_reads` | Contrato, RLS, RPCs, proyección pública y procedencia demo. |
| `20260830062000_harden_travel_document_storage.sql` | `20260830091550 harden_travel_document_storage` | Slugs, privilegios del padre y límites del bucket privado. |
| `20260830093000_lock_down_travel_satellite_privileges.sql` | `20260830094037 lock_down_travel_satellite_privileges` | Allowlist DML exacta para las cuatro tablas satélite. |

La diferencia de timestamps entre archivos locales e historial remoto ya existe en migraciones anteriores del repositorio; esta guía registra el mapeo real sin afirmar que el historial del CLI esté sincronizado. La primera migración completa el contrato anterior de Travel con:

- `interested_people_count` y `climate_celsius` en `artist_trips`;
- procedencia estable (`source_type` y `source_id`) en el grafo para fixtures auditables;
- instantáneas de nombre, contacto y dirección en `trip_studio_links`;
- la tabla `artist_travel_passport_stamps` con RLS por propietario;
- `get_public_travel_share` y `list_public_travel_presences`, que proyectan sólo columnas públicas;
- `list_pending_trip_studio_links`, que permite al estudio leer sus solicitudes sin romper la RLS del viaje;
- `create_artist_trip`, `update_artist_trip_dates`, `cancel_artist_trip`, `reactivate_artist_trip` y `resolve_trip_studio_link` como operaciones transaccionales;
- guardas para no confirmar vínculos de un viaje cancelado y para inicializar checklist/eventos de viajes automáticos nacidos de invitaciones.

La segunda migración cierra la superficie operativa restante:

- impone unicidad sin distinguir mayúsculas, formato normalizado y preflight contra colisiones para `share_slug`;
- reemplaza la política `FOR ALL` por lectura y actualización del propietario, revoca `INSERT`, `DELETE` y `UPDATE` general y permite editar únicamente las columnas descriptivas necesarias; estado, fechas, origen, procedencia y cancelación quedan reservados a RPCs;
- mantiene `artist-trip-docs` privado y limita cada archivo a 10 MiB con MIME `application/pdf`, `image/jpeg`, `image/png` o `image/webp`.

La tercera revoca los grants amplios históricos de `trip_checklist_items`, `trip_documents`, `trip_events` y `trip_studio_links` y concede sólo el DML usado por el workspace. La verificación remota confirmó que `authenticated` no conserva `TRUNCATE`, `TRIGGER` ni `REFERENCES`, y que `anon` no puede leer esas tablas. Las migraciones de Storage y ACL están envueltas en transacciones; la primera bloquea `artist_trips` durante el preflight de slugs.

La activación del share ocurre sólo después de una acción explícita de envío/copia sobre la fila propia de `artist_trips`; abrir el diálogo no cambia el estado ni permite seleccionar una URL inactiva. El visitante anónimo nunca recibe lectura directa de la tabla. La ruta `/travel/t/<slug>` resuelve el slug no secuencial mediante `get_public_travel_share`; la vista pública compara la fecha final contra el inicio del día local para no finalizar un viaje antes de terminar su último día.

## Fixture Figma

`supabase/seeds/20260830_isainaz_travel_figma_demo.sql` construye para `isainazartattoo.wo` un grafo coherente y acotado:

- ocho viajes con el reparto exacto `2 confirmado · 3 pendiente · 3 finalizado`;
- el detalle principal de Barcelona del 15 al 22 de agosto de 2026, con Zorro Rojo Tattoo, 12 personas interesadas, 28 °C, 10 tareas —tres completas—, tres documentos y cinco eventos;
- Barcelona Tattoo Expo del `2025-12-05` al `2025-12-07`, en estado `finalizado`;
- estudios, contactos, Passport y cronología suficientes para que los nueve estados tengan datos coherentes.

Los tres metadatos de Barcelona tienen archivos PDF sintéticos reales, sin reservas ni datos personales verdaderos. Se generan con `scripts/generate-travel-pdf-fixtures.py` y viven en `supabase/fixtures/travel-figma-20260830/`:

| Archivo local | Objeto privado en `artist-trip-docs` |
| --- | --- |
| `Pasaje_ida_vuelta.pdf` | `e5e3be81-784d-469c-bb86-13952f2a0c08/travel-figma-20260830/Pasaje_ida_vuelta.pdf` |
| `Reserva_hotel_barcelona.pdf` | `e5e3be81-784d-469c-bb86-13952f2a0c08/travel-figma-20260830/Reserva_hotel_barcelona.pdf` |
| `Acuerdo_costa_ink.pdf` | `e5e3be81-784d-469c-bb86-13952f2a0c08/travel-figma-20260830/Acuerdo_costa_ink.pdf` |

El preflight convierte cinco viajes legacy exactos a propiedad demo, inserta tres viajes nuevos, valida que ninguno de los nueve `source_id` reservados de vínculos pertenezca a otra fila, reemplaza sólo los satélites validados de Barcelona y retira un grafo automático de invitación identificado de forma exacta, incluido su hilo, participante, mensaje y actividad de Inbox. Si el estado previo difiere, aborta en vez de borrar o adoptar datos por coincidencias amplias. APPLY bloquea todas las relaciones del grafo antes del preflight para impedir pérdidas por escrituras concurrentes. Todos los registros del fixture quedan identificados por `source_type = 'demo'` y `source_id` estables.

El seed se aplicó y reaplicó sobre el estado demo exacto para verificar idempotencia; la última ejecución retiró además el hilo de Inbox que apuntaba al grafo automático ya retirado. La comprobación remota final confirmó ocho viajes demo, el reparto `2/3/3`, Barcelona Tattoo Expo en las fechas anteriores, tres sellos Passport, tres objetos PDF privados, ningún hilo referido al viaje automático y `0` filas QA temporales.

## Aplicación y rollback

1. En una instalación nueva, aplicá en orden `20260830013000_secure_travel_data_contract.sql`, `20260830062000_harden_travel_document_storage.sql` y `20260830093000_lock_down_travel_satellite_privileges.sql`. En `flbgmlvfiejfttlawnfu` no los reapliques: ya están registrados bajo las versiones remotas de la tabla anterior. Como el repositorio arrastra divergencias históricas de timestamps, no ejecutes `supabase db push` contra ese proyecto hasta una reconciliación repo-wide; verificá primero `list_migrations` y aplicá sólo scripts realmente ausentes mediante el flujo operativo controlado.
2. Ejecutá `20260830_isainaz_travel_figma_demo.sql`. Sus verificaciones e IDs estables permiten repetir la aplicación sobre el estado demo exacto.
3. Generá los PDFs con `python scripts/generate-travel-pdf-fixtures.py` y subí los tres archivos por la API de Storage, autenticado como el artista propietario, a las rutas exactas de la tabla anterior. Usá `contentType: 'application/pdf'` y `upsert: false`; no insertes filas directamente en `storage.objects`.
4. Verificá los ocho viajes, el reparto de estados, el detalle de Barcelona, los satélites, la lectura pública de un slug permitido y que los tres `trip_documents.storage_path` tengan objeto, tamaño mayor que cero y MIME PDF. Confirmá además cada descarga mediante URL firmada (`200`, `application/pdf`, cabecera `%PDF-`).
5. Para retirar el fixture, ejecutá manualmente y una sola vez el bloque comentado **ROLLBACK / RESTORE** del final del seed como una transacción completa. Confirmá que el preflight terminó y la transacción hizo `COMMIT`; si aborta, no elimines ningún objeto de Storage.
6. Sólo después de que el rollback SQL haya terminado correctamente, eliminá por la API de Storage las tres rutas exactas de la tabla, autenticado como el propietario o mediante tooling operativo con service role:

   ```js
   await supabase.storage.from('artist-trip-docs').remove([
     'e5e3be81-784d-469c-bb86-13952f2a0c08/travel-figma-20260830/Pasaje_ida_vuelta.pdf',
     'e5e3be81-784d-469c-bb86-13952f2a0c08/travel-figma-20260830/Reserva_hotel_barcelona.pdf',
     'e5e3be81-784d-469c-bb86-13952f2a0c08/travel-figma-20260830/Acuerdo_costa_ink.pdf',
   ]);
   ```

   Verificá que las tres rutas ya no existan. Nunca borres `storage.objects` por SQL: eso puede dejar binarios huérfanos. Si este cleanup falla, repetilo sobre las mismas rutas exactas; los objetos quedan privados y sin filas `trip_documents`, no referencias vivas sin archivo.

El rollback es deliberadamente manual y no idempotente. Adquiere bloqueos `SHARE ROW EXCLUSIVE` sobre todo el grafo antes de un preflight de los ocho padres, Passport y cada hijo; si hubo cambios posteriores, aborta sin sobrescribirlos. Elimina hijos demo y los tres viajes insertados, restaura los cinco viajes legacy, sus 14 tareas, cinco eventos y cinco vínculos, y recrea el grafo automático de invitación con su auditoría y las cuatro filas exactas de Inbox. Se ensayó remotamente como una transacción completa terminada en `ROLLBACK`, sin persistir cambios. El bloque SQL no elimina binarios de Storage, por eso el paso posterior de `remove` es obligatorio cuando se ejecuta el rollback real. Tampoco revierte ninguna de las tres migraciones; tablas, columnas, RLS, permisos, límites y RPCs permanecen instalados.

## Evidencia de QA

La matriz completa de fuentes, capturas implementadas y comparaciones combinadas está en [`design-qa.md`](../design-qa.md). Incluye viewport, densidad, geometría desktop, responsive a `390`, `768`, `1024`, `1100`, `1200`, `1280`, `1444` y `2560` px, historial de ajustes y comprobaciones por estado. La corrección final de ancho usa la captura amplia `2560 × 2726` entregada por el usuario y verifica un área útil de `1600` px con reparto exacto `1200 / 400`, además de Passport proporcional y ausencia de overflow. El changelog registra únicamente verificaciones confirmadas; no debe inferirse una suite automática no consignada.
