# Estudios en We Otzi

Actualizado: 2026-05-27  
Alcance: modulo local de Estudios en `C:\dev\weotzi-unified`.

## Resumen

Los estudios son un tipo de usuario de primera clase. Tienen cuenta propia de Supabase Auth, una fila en `studios`, perfil publico, sedes, roster de artistas, spots abiertos, operaciones internas, inventario, proveedores, sponsors, documentos, facturas internas y analytics.

El frontend es HTML/CSS/JavaScript vanilla bajo `public/studio*` y `public/shared/js/studio-*`. La persistencia CRUD de dashboard usa Supabase directamente con RLS. El unico flujo server-side propio del modulo es `POST /api/studio/notify`, porque compone y dispara notificaciones con datos verificados y service-role.

## Rutas

| Ruta | Acceso | Funcion |
| --- | --- | --- |
| `/studio/register` | Publica | Wizard de registro de estudio en 5 pasos: cuenta, identidad, sedes, fotos, confirmar. |
| `/studio/login` | Publica | Login, recuperacion de password y entrada al dashboard. |
| `/studio/dashboard` | Estudio autenticado | Panel completo de gestion. |
| `/studio/profile/?studio=<slug-o-id>` | Publica | Perfil publico con portada, bio, estilos, roster, galeria, sedes, mapa y sponsors publicos. |
| `/studio-spots` | Publica/artista | Directorio de spots abiertos; artistas autenticados pueden postular. |
| `/artist/invitations` | Artista autenticado | Invitaciones pendientes y memberships activas con estudios. |

## Dashboard

`/studio/dashboard` contiene nueve superficies:

- **Perfil**: nombre, tagline, bio, ano de fundacion, idiomas, Instagram, web, WhatsApp, cover, logo y galeria.
- **Sedes**: CRUD de `studio_locations`, sede primaria, address picker y coordenadas.
- **Roster**: busqueda de artistas, invitaciones, roles, sedes, split, pausa/reactivacion y desvinculacion.
- **Spots**: crear drafts o spots abiertos, subir cover, registrar adjunto `studio_spot_attachments`, revisar postulaciones y aceptar/rechazar.
- **Operaciones**: ledger de trabajos, clientes derivados, facturas internas con items y biblioteca de documentos.
- **Inventario**: items, stock, movimientos, consumo por artista y resumen de salud de stock.
- **Proveedores**: contactos, categorias y notas.
- **Sponsors**: marcas aliadas, logo, tier, vigencia, monto, visibilidad publica y asignacion a artistas del roster.
- **Analytics**: metricas mensuales, performance por artista y soporte SQL para salud de inventario.

## Modelo de datos

Tablas principales:

- `studios`: identidad, ownership (`user_id`), marca, contacto y estado.
- `studio_locations`: sedes y coordenadas.
- `studio_artist_memberships`: relacion canonica estudio-artista.
- `studio_spots`, `studio_spot_applications`, `studio_spot_attachments`: oportunidades, postulaciones y adjuntos.
- `studio_jobs_log`: trabajos realizados.
- `studio_invoices`, `studio_invoice_items`: facturacion interna no fiscal.
- `studio_documents`, `studio_document_attachments`: biblioteca y asociaciones polimorficas.
- `studio_suppliers`: proveedores.
- `studio_inventory_items`, `studio_inventory_movements`: stock y ledger de movimientos.
- `studio_sponsors`, `studio_sponsor_artists`: sponsors y artistas asociados.

Vistas:

- `studio_dashboard_metrics_view`: agregados mensuales desde `studio_jobs_log`.
- `studio_artist_performance_view`: performance por artista.
- `studio_inventory_health_view`: stock activo, reorder y valor de inventario.
- `studio_public_sponsors_view`: superficie publica limitada para mostrar sponsors sin exponer notas, contratos ni montos.

## Storage

La migracion `supabase/migrations/20260527000000_studio_storage_and_views.sql` asegura:

- `studio-photos`: publico; cover, logo, galeria y logos de sponsors.
- `studio-spot-attachments`: publico; covers/imagenes de spots abiertos.
- `studio-documents`: privado; documentos operativos.

Las policies permiten que el estudio dueno gestione objetos bajo el prefijo `<studio_id>/...`. Soporte activo tambien puede operar. Los documentos no tienen lectura anonima.

## Seguridad

- RLS de Supabase es la defensa principal para CRUD del dashboard.
- `POST /api/studio/notify` exige `Authorization: Bearer <supabase_access_token>`.
- El backend resuelve el usuario con `_getAuthUserFromBearer(req)`.
- El endpoint solo permite notificar si `studios.user_id` coincide con el caller o si el caller es soporte activo.
- `decision` se valida como `accepted` o `rejected`.
- El fallback de desarrollo ya no loguea el email completo del artista.
- La vista publica de sponsors expone solo columnas publicas; el dashboard usa la tabla completa con RLS de owner.

## Flujos vinculados

### Registro de estudio

1. El usuario completa `/studio/register`.
2. `studio-register.js` crea Supabase Auth con `user_type=studio`.
3. Inserta `studios` con `user_id`.
4. Inserta sedes en `studio_locations`.
5. Actualiza `primary_location_id`.
6. Redirige a `/studio/dashboard`.

### Spot y postulacion

1. El estudio crea un spot en dashboard.
2. Si agrega cover, se guarda `studio_spots.cover_image` y se sincroniza `studio_spot_attachments`.
3. El spot abierto aparece en `/studio-spots`.
4. Artista autenticado postula y crea `studio_spot_applications`.
5. Estudio acepta/rechaza desde dashboard.
6. Si acepta, se crea `studio_artist_memberships`.
7. El dashboard llama `/api/studio/notify` con Bearer JWT.

### Invitacion al roster

1. Estudio busca un artista desde tab Roster.
2. Inserta `studio_artist_memberships` en `pending_acceptance`.
3. Llama `/api/studio/notify`.
4. Artista acepta o rechaza desde `/artist/invitations`.

### Operaciones e inventario

1. Estudio registra trabajos en `studio_jobs_log`.
2. Clientes se derivan del ledger.
3. Facturas internas usan `studio_invoices` + `studio_invoice_items`; el trigger recalcula totales.
4. Inventario usa `studio_inventory_items`.
5. Movimientos en `studio_inventory_movements` actualizan stock por trigger.
6. La migracion nueva evita que un movimiento apunte a un item de otro estudio para filas nuevas.

### Sponsors publicos

1. Estudio crea sponsor en dashboard.
2. Puede asignar artistas activos del roster.
3. Si `is_public=true`, aparece en `/studio/profile` mediante `studio_public_sponsors_view`.

## Responsive

`public/shared/css/studio.css` cubre movil, tablet y desktop:

- Masthead se apila en mobile y sus acciones usan scroll horizontal.
- Dashboard pasa de sidebar fijo a rail horizontal en tablet.
- Tablas usan overflow horizontal controlado.
- Cards de spots usan `minmax(min(100%, 320px), 1fr)` para evitar overflow.
- Perfil publico apila contenido/aside y reduce altura de mapa en mobile.
- Tarjetas de sponsors, health cards y checkboxes usan grids fluidos.

## Verificacion local

Comandos ejecutados durante el cierre:

```powershell
node --test tests/studio-notify-auth.test.js
node --check server.js
node --check public/shared/js/studio-dashboard.js
node --check public/shared/js/studio-dashboard-ops.js
node --check public/shared/js/studio-profile.js
node --check public/shared/js/studio-spots-directory.js
```

QA visual esperado:

- `/studio/login`
- `/studio/register`
- `/studio-spots`
- `/studio/profile/?studio=palermo-tattoo-club`
- `/studio/dashboard` redirige a login si no hay sesion.

## Plan de pruebas de usuario

Para ejecutar una corrida manual completa de principio a fin, usar:

- `docs/STUDIOS_USER_QA_WALKTHROUGH.md`: guia paso a paso para validar registro, login, dashboard, perfil publico, spots, postulaciones, roster, operaciones, inventario, sponsors, analytics, seguridad funcional y responsive.
- `docs/STUDIOS_TEST_PLAN.md`: respaldo tecnico con casos atomicos, SQL, RLS, Storage y notificaciones.

## Pendiente fuera de esta entrega

- Facturacion legal/fiscal con PDF y numeracion por jurisdiccion.
- Limpieza automatica de objetos viejos de Storage cuando se reemplazan URLs.
- UI avanzada para adjuntar documentos a targets concretos (`invoice`, `membership`, `spot_application`, `job_log`); la tabla ya existe.
- Validar y, si hay datos historicos inconsistentes, normalizar `location_id` contra `studio_id` antes de agregar constraints compuestos sobre todas las relaciones con sedes.
