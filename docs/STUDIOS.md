# Estudios en We Otzi

Actualizado: 2026-10-30
Alcance: modulo local de Estudios en `C:\dev\weotzi-unified`.

## Plataforma de Estudios (2026-10-30)

La rama `feature/estudios-plataforma` convierte el dashboard en el sistema administrativo del estudio. El contrato completo entre modulos esta en [plans/2026-10-30-estudios-plataforma.md](plans/2026-10-30-estudios-plataforma.md). Las migraciones `20261030200000`–`20261030204000` estan **NO aplicadas**. Cada una tiene su rollback en `supabase/rollbacks/` y sus tests SQL en `supabase/tests/`. El frontend degrada mientras falten: muestra "falta aplicar una migracion" o cae al flujo anterior.

| Pestaña | Que hace |
| --- | --- |
| Inicio | Pendientes con enlaces (solicitudes, contratos por firmar o por vencer, citas de hoy y mañana, stock bajo, pedidos en camino, postulaciones nuevas) y los KPIs del mes por moneda. |
| Solicitudes | **Altas** que piden los artistas (aprobar, aprobar con contrato, rechazar), **cambios pedidos** a invitaciones y **contraofertas** a postulaciones. |
| Spots | Spots para residentes, guest e itinerantes. Cada uno define que incluye, beneficios (`benefit_tags`), que se espera, requisitos y modalidad: porcentaje, fijo (con quien paga) o mixto. Aceptar una postulacion abre el editor de contrato. |
| Contratos | Borrador → emitir y firmar (dueño) → firma del artista → membresia activa. Terminos congelados (`terms_snapshot` + `terms_hash` SHA-256), documento imprimible, cancelar, rescindir y nueva version. Los guest con fecha de fin pasan a `ended` al vencer. |
| Agenda | Dia (columnas por artista), semana y lista. Muestra las citas y bloques "Ocupado" sin detalle de la agenda personal del artista, sus sesiones de cotizaciones y otros estudios, con chequeo de disponibilidad en vivo. Al completar una cita se crea el trabajo con el split del contrato. |
| Inventario | Stock, movimientos y **materiales por artista**: entregas (`assignment`) y devoluciones (`return`) con costo y balance. |
| Reposicion | Sugerencias por stock bajo, catalogo de Supplies verificados con descuento We Otzi, carrito por proveedor, pedidos y recepcion que repone stock y registra el gasto. Ver [SUPPLIES.md](SUPPLIES.md). |
| Tienda | Sobre la Store compartida (`store_*`, traída de `feature/store-artista` hasta 0985a29): ajustes (contacto, cobro, dirección de retiro), productos físicos (merch, aftercare, joyería) con variantes y stock, publicación, pedidos online y **venta en mostrador** (`create_store_pos_order`, M6 `20261030205000`, NO aplicada). La vitrina aparece en el perfil público (`get_public_storefront('studio', slug)`). Sin Store aplicada, la merch se registra en Finanzas como `merch_manual`. |
| Finanzas | Gastos e ingresos (alquiler de puesto, merch manual, sponsors, etc.) con comprobante privado en `studio-documents/<studio_id>/finance/` y anulacion con motivo. |
| Reportes | Tatuajes, ingreso del estudio por tatuajes, merch, otros ingresos, gastos y resultado por moneda; resultado mensual, gastos por categoria, top artistas, materiales por artista y compras a Supplies, con CSV. Debajo sigue el Analytics anterior. |

**Alta en dos sentidos.** El estudio invita y el artista acepta, o firma el contrato si la invitacion tiene uno. El artista solicita el alta desde el detalle del estudio en `/artist/invitations` o al registrarse, y el estudio aprueba. Un guard en `studio_artist_memberships` impide que el estudio active a alguien sin su consentimiento. El perfil publico y la marca "tatua en" salen solo de membresias activas (vista `studio_public_roster`).

**Reclamo de estudio.** Los 40 estudios del catalogo no tienen dueño. En `/studio/register` el estudio busca su ficha y la reclama; soporte la aprueba en el backoffice (**Revisiones**).

**Seguridad.**
- Guards de escritura en membresias, postulaciones, `studios` (`is_verified`, `user_id`) y `artists_db.studio_id`.
- RPC SECURITY DEFINER con validacion de pertenencia cruzada.
- Arreglo de las policies de Storage de los buckets `studio-*`: comparaban `studios.name` en lugar del path del objeto, y por eso hoy solo soporte puede subir archivos.
- Emails siempre al email de auth del dueño o del artista.

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

### Registro de estudio (revisión Estudios v1, nov 2026)

Cinco pasos en `/studio/register` (`studio-register.js`):

1. **Cuenta.** Al continuar, `Studios.findMatches` (RPC `find_studio_matches`) busca estudios con el mismo nombre o uno parecido (tokens sin acentos ni palabras genéricas) y muestra la advertencia con: iniciar sesión (estudio con dueño), reclamar la ficha (sin dueño, `WeOtziStudioAuth.claim`), registrar una sede (login con `?next=sedes`), cambiar el nombre o seguir como estudio distinto. Seguir pide confirmar que ninguna sede comparte dirección y, si el nombre es idéntico, uno que lo distinga (`normalized_name` sigue siendo único).
2. **Identidad.** Año de fundación con calendario de años e idiomas con selección múltiple (`studio-register-pickers.js`). Si el Instagram ya figura en otro estudio, se avisa y se pide confirmarlo. El import de Instagram avisa que las fotos se publican cuando se valida la cuenta.
3. **Sedes.** Buscador de Google Places (dropdown opaco en el DS) y pin arrastrable en el mapa; al mover el pin se trae la dirección desde Google Maps (`studio-location-map.js`). Ninguna sede puede coincidir con la dirección de un estudio parecido: a menos de 40 m, mismo texto, o misma calle y número a menos de 1 km.
4. **Fotos.** Sin cambios.
5. **Confirmación.** Vista previa del perfil editable en el lugar (nombre, tagline, bio, año, idiomas, Instagram, web, WhatsApp, nombres de sedes, portada y logo).

`complete_studio_registration` repite en el servidor el control de nombre y dirección (errores 23514 reclamable, 23505 nombre idéntico, 23P01 dirección) y deja el estudio con `verification_required` y una solicitud de verificación pendiente cuando coincide con otro.

### Verificación de estudios

- Estado en `studios.verification_status` (unverified, pending, verified, rejected) junto a `is_verified`. Solo soporte o el servidor lo cambian (guard).
- El dueño completa la información desde Panel → Verificación (`request_studio_verification`) y valida el Instagram con un código WO-XXXXXX que manda por DM a @weotzi (`/api/studio/verification`, `/api/studio/verification/instagram`; el webhook de DMs de artistas también resuelve códigos de estudios).
- Soporte decide en Backoffice → Verificaciones de estudios (`/api/admin/studio-verifications`, RPC `decide_studio_verification`) y puede confirmar el Instagram en el mismo paso. El estudio recibe un email (`studio_verification_decision`).
- El perfil público muestra el sello "Verificado" y oculta las fotos importadas de Instagram hasta validar la cuenta (`gallery-visibility.js`, misma regla que el artista).
- Migraciones: `20261102120000_studio_verification`, `20261102130000_studio_matches_unowned_fix` y `20261102140000_studio_address_match`, APLICADAS en `flbgmlvfiejfttlawnfu` el 2026-11-02, con rollback y test SQL (`supabase/tests/studio_verification.sql`).

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
