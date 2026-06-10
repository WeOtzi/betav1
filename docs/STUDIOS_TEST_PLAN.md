# Studios — Plan de pruebas reales y casos prácticos

**Versión:** 1.1.0
**Fecha:** 2026-05-27
**Cubre:** Phases A-F del plan "Studios as a first-class user type" + cierre funcional de Storage, notificaciones seguras, sponsors publicos y responsive.
**Pruebas totales:** 55 casos · 6 flujos completos end-to-end

---

## Índice

1. [Resumen ejecutivo: ¿qué se implementó?](#1-resumen-ejecutivo)
2. [Preparación del entorno de pruebas](#2-preparación-del-entorno)
3. [Casos prácticos end-to-end](#3-casos-prácticos-end-to-end)
   - 3.1 [Flujo "Soy estudio nuevo"](#31-flujo-soy-estudio-nuevo)
   - 3.2 [Flujo "Quiero contratar artistas"](#32-flujo-quiero-contratar-artistas)
   - 3.3 [Flujo "Soy artista que aplica a un spot"](#33-flujo-soy-artista-que-aplica-a-un-spot)
   - 3.4 [Flujo "Manejo el día a día del estudio"](#34-flujo-manejo-el-día-a-día-del-estudio)
   - 3.5 [Flujo "Cierro el mes y reviso ganancias"](#35-flujo-cierro-el-mes-y-reviso-ganancias)
   - 3.6 [Flujo "Sumo sponsors a mi estudio"](#36-flujo-sumo-sponsors-a-mi-estudio)
4. [Pruebas atómicas por superficie](#4-pruebas-atómicas-por-superficie)
5. [Validaciones de seguridad (RLS)](#5-validaciones-de-seguridad-rls)
6. [Smoke test rápido (15 min)](#6-smoke-test-rápido-15-min)
7. [Datos de prueba que ya existen](#7-datos-de-prueba-que-ya-existen)

---

## 1. Resumen ejecutivo

**¿Qué se construyó?**

Un sistema completo de "Estudios como tipo de usuario de primera clase" con 6 fases, todas en producción:

| Fase | Entrega | Estado |
| --- | --- | --- |
| **A** | Auth Supabase + register wizard de 5 pasos + login + dashboard skeleton + perfil público con mapa multi-sede | ✅ |
| **B** | Directorio público de spots + editor en dashboard + revisión de postulaciones + página de invitaciones del artista | ✅ |
| **C** | Roster CRUD completo (invitar / mover / cambiar rol / split / desvincular) | ✅ |
| **D** | Operaciones: jobs ledger + vista de clientes + facturación interna con line items + biblioteca de documentos | ✅ |
| **E** | Inventario con consumo por artista + proveedores + sponsors | ✅ |
| **F** | Analytics (3 vistas SQL): métricas mensuales + performance por artista + salud de inventario | ✅ |

**Tablas creadas (14):**
`studios` (extendida), `studio_locations`, `studio_artist_memberships`, `studio_spots`, `studio_spot_applications`, `studio_spot_attachments`, `studio_jobs_log`, `studio_invoices`, `studio_invoice_items`, `studio_documents`, `studio_document_attachments`, `studio_inventory_items`, `studio_inventory_movements`, `studio_suppliers`, `studio_sponsors`, `studio_sponsor_artists`.

**Vistas SQL (4):**
`artists_with_location` (v2 — repointed a studio_locations), `studio_dashboard_metrics_view`, `studio_artist_performance_view`, `studio_inventory_health_view`.

**Triggers (8):**
`updated_at` en cada tabla, `bump_studio_spot_app_count`, `recompute_invoice_totals`, `apply_inventory_movement`, `sync_artists_db_studio_id_from_membership`.

**Páginas frontend nuevas:**
`/studio/login`, `/studio/register`, `/studio/dashboard`, `/studio/profile/?studio=<slug>`, `/studio-spots`, `/artist/invitations`.

**Archivos compartidos:**
`/shared/css/studio.css`, `/shared/js/studio-auth.js`, `/shared/js/studio-register.js`, `/shared/js/studio-dashboard.js`, `/shared/js/studio-dashboard-ops.js`, `/shared/js/studio-profile.js`, `/shared/js/studio-spots-directory.js`, `/shared/js/artist-invitations.js`.

**Lo que NO se construyó (fuera de scope explícito):**

- **Phase G** — facturación legal con PDF + numeración fiscal por jurisdicción.

**Agregados en v1.1:**

- **Subida directa de archivos a Supabase Storage** vía 3 buckets (`studio-photos` público, `studio-documents` privado, `studio-spot-attachments` público). Módulo reusable `WeOtziUploader` reemplaza los inputs de URL en el dashboard (Perfil - cover/logo/galería; Operaciones - Documentos; Spots - cover; Sponsors - logo).
- **Notificaciones por email seguras** vía `POST /api/studio/notify` con dos `kind`: `spot_decision` y `roster_invite`. El endpoint exige Bearer JWT, valida ownership del estudio o soporte activo, valida `decision` y compone subject/body server-side con datos verificados.
- **Sponsors publicos en perfil**: `/studio/profile` renderiza `studio_public_sponsors_view` y muestra marcas aliadas y artistas asociados cuando existen.
- **Inventario con health summary**: el dashboard muestra items activos, items a reponer y valor estimado del stock usando `studio_inventory_health_view` cuando esta disponible.
- **Responsive hardening**: masthead, rail de tabs, tablas, spots grid, perfil publico, sponsor cards y health cards fueron ajustados para movil, tablet y desktop.

---

## 2. Preparación del entorno

### 2.1 Pre-requisitos

- El servidor `node server.js` corriendo en `http://localhost:4545` (o el dominio de staging).
- Las migraciones de la serie `20260430*` a `20260503*` y `20260527000000_studio_storage_and_views.sql` aplicadas en la base de Supabase activa (`flbgmlvfiejfttlawnfu`).
- Acceso a una cuenta de email para recibir el reset password si fuera necesario.

### 2.2 Cuentas de prueba que vas a necesitar

Para los flujos completos vas a usar **dos cuentas distintas** (un estudio y un artista), ambas creadas durante las pruebas:

| Rol | Email sugerido | Por qué dos |
| --- | --- | --- |
| Estudio dueño | `studio-test-001@weotzi.test` | Para crear, publicar spots, registrar jobs, etc. |
| Artista aplicante | `artist-test-001@weotzi.test` | Para postular a un spot y aceptar invitaciones |

> **Tip**: Supabase auto-confirma emails en este entorno (181 usuarios actuales todos `email_confirmed_at` ≠ null), así que no necesitas un buzón real para terminar el registro.

### 2.3 Datos demo ya cargados

- **25 estudios** (incluyendo "Palermo Tattoo Club" con 3 sedes, perfil rico y 3 residentes).
- **2 spots abiertos** para postular (Palermo Tattoo Club + Bang Bang NYC).
- **76 artistas** con direcciones estructuradas (Phase B).
- **20 memberships activas** ya vinculando artistas a estudios.

Esto significa que podés probar el lado público (mapa, directorio, perfiles) **sin crear nada** — y los flujos de creación los hacés con tu propia cuenta de prueba.

---

## 3. Casos prácticos end-to-end

Cada flujo termina en un estado verificable en la base. Si todos pasan, las 6 fases están operativas.

### 3.1 Flujo "Soy estudio nuevo"

**Actor:** Dueño/a de estudio que se registra por primera vez.
**Verifica:** Phase A (auth + register + dashboard + perfil público).
**Tiempo estimado:** 8–10 min.

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Visitar `http://localhost:4545/studio/register` | Aparece la pantalla del wizard con 5 píldoras (Cuenta · Identidad · Sedes · Fotos · Confirmar). La píldora 1 está activa. |
| 2 | Completar Paso 1 — Cuenta: nombre `Estudio Test 001`, email `studio-test-001@weotzi.test`, password `TestPass1234!` (repetida) → "Continuar" | Avanza a Paso 2 sin errores. |
| 3 | Completar Paso 2 — Identidad: tagline corto, bio de 2 frases, año `2024`, idiomas `Español, Inglés`, IG `@estudiotest`, web `https://estudiotest.com`, WA `+5491100000000` → "Continuar" | Avanza a Paso 3. |
| 4 | Paso 3 — Sedes: en "Sede principal" tipear "Av. Santa Fe 1750, Buenos Aires" en el campo de dirección y elegir la sugerencia de Google. La preview estructurada muestra país/ciudad/calle/código postal | El bloque `.weotzi-address-fields` se rellena automáticamente con todos los campos. |
| 5 | Click "+ Agregar otra sede" → repetir con "Honduras 5024, Buenos Aires" → "Continuar" | Hay 2 bloques `.studio-location-row` con direcciones válidas. |
| 6 | Paso 4 — Fotos: pegar URL de portada (cualquier imagen pública, ej. `https://images.unsplash.com/photo-1565992441121-4367c2967103?w=2100`) y 3 URLs en la galería (separadas por línea) → "Continuar" | Avanza a Paso 5. |
| 7 | Paso 5 — Confirmar: revisar el resumen (Sedes con dirección = 2, Fotos cargadas = 3) → "Crear estudio" | Aparece el mensaje "¡Estudio creado! Redirigiendo al panel…" y el navegador va a `/studio/dashboard`. |
| 8 | Verificación DB (opcional, vía Supabase MCP): `SELECT id, name, slug, user_id IS NOT NULL AS has_owner, primary_location_id IS NOT NULL AS has_primary FROM studios WHERE slug = 'estudio-test-001';` | Devuelve la fila con `has_owner=true` y `has_primary=true`. |
| 9 | En el dashboard, click "Ver perfil público" → debe abrir `/studio/profile/?studio=estudio-test-001` en otra pestaña | El perfil renderiza con el nombre, tagline, bio, mapa con 2 pins numerados (★01 + 02), 3 fotos en la galería, sección "Sedes = 2" en el meta grid. |
| 10 | Logout (botón "Salir" en el dashboard) → tratar de visitar `/studio/dashboard` directamente | Redirige a `/studio/login`. |

**Variantes a probar:**

- Email duplicado en Paso 1 → debe mostrar mensaje "Ya existe una cuenta con ese email".
- Password de menos de 8 caracteres → debe rechazar.
- Passwords distintas → debe rechazar.
- Saltar el Paso 3 sin elegir dirección → bloquea con "Agregá al menos una sede".

---

### 3.2 Flujo "Quiero contratar artistas"

**Actor:** Estudio ya creado (usar la cuenta del flujo 3.1, o reusar Palermo Tattoo Club si tenés acceso).
**Verifica:** Phase B (publicar spot) + Phase C (invitar manualmente).
**Tiempo estimado:** 10–12 min.

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Login en `/studio/login` con la cuenta del estudio | Aparece el dashboard. |
| 2 | Tab "Spots" → "Nuevo spot" | Se abre el editor inline con título / tipo / descripción / estilos / fechas / split / stipend / housing. |
| 3 | Completar: título `Guest spot mayo`, tipo `Guest spot`, descripción de 2 frases, estilos `Realismo, Fine Line`, fecha inicio `2026-05-01`, fin `2026-05-28`, split `60`, stipend vacío, housing desmarcado → "Publicar (abierto)" | Aparece "Spot creado." y la lista debajo muestra el nuevo spot con estado `open`. |
| 4 | Visitar `/studio-spots` en otra pestaña anónima | El nuevo spot aparece en el grid público con la pildora "Guest spot" arriba a la izquierda. |
| 5 | Verificación DB: `SELECT id, title, status, application_count FROM studio_spots WHERE status='open' ORDER BY created_at DESC LIMIT 1;` | Devuelve el nuevo spot con `application_count=0`. |
| 6 | Volver al dashboard, tab "Roster" | Lista de miembros activos del estudio. Si es un estudio nuevo, está vacía con el mensaje correspondiente. |
| 7 | En la barra de invitar: tipear `yomico` en el buscador → aparecen sugerencias (artistas reales de la BD) | Sugerencias visibles abajo del input. |
| 8 | Click en una sugerencia → el input se rellena con el nombre del artista | Botón "Invitar" queda listo. |
| 9 | Elegir rol `Itinerante`, sede `Sede principal` → "Invitar" | Aparece "Invitación enviada. El artista la verá en su panel." y la fila aparece en la tabla con estado `pending_acceptance`. |
| 10 | Verificación DB: `SELECT m.role, m.status, a.username FROM studio_artist_memberships m JOIN artists_db a ON a.user_id = m.artist_user_id WHERE m.status = 'pending_acceptance' ORDER BY invited_at DESC LIMIT 1;` | Devuelve la invitación con el rol y artista correctos. |

**Variantes a probar:**

- Cambiar rol `Residente → Itinerante → Guest` en una fila de la tabla → "Guardar" → recargar → el cambio persiste.
- Cambiar `revenue_split_pct` a `55` → "Guardar" → persiste.
- Click "Desvincular" en un miembro activo → confirm → estado pasa a `ended` y desaparece de la lista (con `is_active=false`).
- Crear un spot duplicado del mismo nombre → debe permitirse (no hay UNIQUE en title).
- Crear un spot con `end_date` anterior a `start_date` → debe rechazar por el constraint `studio_spots_dates_check`.

---

### 3.3 Flujo "Soy artista que aplica a un spot"

**Actor:** Artista existente (creá una cuenta con el wizard de `/register-artist` si no tenés una; o usá una cuenta artista demo de `artists_db`).
**Verifica:** Phase B (postulación pública) + Phase C (aceptar invitación).
**Tiempo estimado:** 6–8 min.

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Visitar `/studio-spots` sin login | Lista de spots públicos abiertos. |
| 2 | Click en una card del spot → modal con detalles | Aparece la sección "Mensaje para el estudio" pero como no hay sesión, en su lugar se ve un botón "Ingresá para postular". |
| 3 | Click ese botón → te lleva a `/artist/login?returnTo=/studio-spots/...` | Pantalla de login del artista. |
| 4 | Login como artista → volvés a `/studio-spots` | El modal del spot se queda abierto si lo tenías; si no, click otra vez en la card. |
| 5 | Esta vez aparece formulario: textarea "Mensaje para el estudio" + input "URL de portfolio" + botón "Postularme" | Campos editables. |
| 6 | Escribir mensaje breve, dejar URL pre-rellenada, click "Postularme" | Aparece "¡Postulación enviada! El estudio la verá en su panel." y el botón se oculta. |
| 7 | Verificación DB: `SELECT status, message FROM studio_spot_applications WHERE artist_user_id = auth.uid() ORDER BY created_at DESC LIMIT 1;` (con la sesión del artista) | Devuelve la aplicación con `status='pending'`. |
| 8 | Cerrar sesión, login como el estudio dueño del spot → tab "Spots" → en la lista, click "Postulaciones (1)" en el spot correspondiente | Aparece tabla con la postulación, el nombre del artista, y botones "Aceptar" / "Rechazar". |
| 9 | Click "Aceptar" | Status cambia a `accepted` y aparece el mensaje "¡Aceptado y sumado al roster!". |
| 10 | Tab "Roster" → el artista aparece como miembro activo con el rol correspondiente al `kind` del spot (guest_spot → role=guest). | El roster ahora incluye al artista. |
| 11 | Login de vuelta como el artista → `/artist/invitations` | Aparece tarjeta "Memberships activas" con el estudio. |
| 12 | Verificación DB: `SELECT m.role, m.status FROM studio_artist_memberships m WHERE m.artist_user_id = auth.uid() AND m.status='active';` (sesión del artista) | Devuelve la membership creada por la aceptación. |

**Variantes a probar:**

- Volver a aplicar al mismo spot → debe rechazar por la UNIQUE `studio_spot_applications_one_per_artist` y mostrar "Ya aplicaste a este spot".
- Aceptar una invitación pendiente desde `/artist/invitations` (botón verde "Aceptar") → status pasa a `active` y aparece bajo "Memberships activas".
- Click "Salir" en una membership activa desde `/artist/invitations` → confirm → la membership cambia a `ended`.

---

### 3.4 Flujo "Manejo el día a día del estudio"

**Actor:** Estudio con al menos 1 artista en el roster.
**Verifica:** Phase D (jobs · clients · invoicing · documents).
**Tiempo estimado:** 12–15 min.

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Login al dashboard del estudio → tab "Operaciones" → sub-pill "Trabajos" | Lista vacía con mensaje "Sin trabajos registrados todavía." |
| 2 | Click "+ Registrar trabajo" → editor inline | Form con fecha-hora (ahora), select de artista (lista los miembros activos), cliente, horas, bruto, splits, supplies, notas. |
| 3 | Completar: artista del roster, cliente "María González", horas `3.5`, bruto `450 USD`, art split `270`, studio split `135`, supplies `15`, notas "Sesión 1 de 2 — flores en antebrazo" → "Guardar" | "Trabajo registrado." y la fila aparece en la tabla. |
| 4 | Sub-pill "Clientes" | Aparece "María González" con sesiones=1, bruto total=450 USD, última visita=hoy. |
| 5 | Sub-pill "Facturas" → "+ Nueva factura" | Editor con número auto (INV-XXXXXX), datos del cliente, fechas, moneda, IVA, sección de Items. |
| 6 | Llenar: nombre `María González`, email opcional, fecha hoy, due date +30 días, moneda USD, IVA `0`. Click "+ Agregar línea". Llenar descripción `Sesión de tatuaje 27/04`, cantidad `1`, precio unitario `450`. → "Guardar" | "Factura guardada." Aparece en la lista con status=`draft`, total=`USD 450.00`. |
| 7 | En la lista, click "Marcar pagada" en esa factura | Status cambia a `paid`. |
| 8 | Verificación DB: `SELECT status, paid_at, total_amount FROM studio_invoices WHERE invoice_number = 'INV-XXXXXX';` | `status='paid'`, `paid_at` ≠ null, `total_amount=450.00`. |
| 9 | Sub-pill "Documentos" → "+ Nuevo documento" | Form con título, tipo, descripción, URL, checkboxes "Plantilla reutilizable" + "Requiere firma". |
| 10 | Crear: título `Consentimiento general`, tipo `consent`, URL pública de un PDF cualquiera, checkbox "Plantilla" marcado, "Requiere firma" marcado → "Guardar" | "Documento guardado." Aparece en la lista. |
| 11 | Verificación DB: `SELECT kind, is_template, requires_signature FROM studio_documents WHERE studio_id = '<id>';` | Devuelve la fila con flags correctos. |

**Variantes a probar:**

- Editar un trabajo existente (botón "Editar") → cambiar bruto a `500 USD` → guardar → recargar → cambio persiste.
- Borrar un trabajo → confirma → desaparece de la lista.
- Editar una factura, agregar otra línea de `100 USD` → "Guardar" → el `total_amount` recalcula automáticamente a `550` (trigger `recompute_invoice_totals`).
- Borrar una factura "draft" → confirma → desaparece, los items se cascadean.

---

### 3.5 Flujo "Cierro el mes y reviso ganancias"

**Actor:** Estudio con varios jobs registrados y al menos 1 invoice pagada.
**Verifica:** Phase F (analytics).
**Tiempo estimado:** 4–5 min.

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Tab "Analytics" del dashboard | Aparece un meta grid con: Bruto (12 meses), Neto al estudio, Trabajos, Clientes únicos. |
| 2 | Si registraste el job del flujo 3.4, los números deben reflejar al menos 1 trabajo, bruto = `450 USD` aprox. | Cifras coherentes con lo cargado. |
| 3 | Sección "Por mes": tabla con mes, trabajos, bruto, neto, pagado a artistas, ticket promedio | El mes actual aparece con los totales. |
| 4 | Sección "Performance por artista": fila por cada artista que hizo al menos un trabajo | Aparece el artista del job, con jobs=1, gross_billed=450, ticket promedio=450, días desde último trabajo=0. |
| 5 | Verificación DB: `SELECT month, jobs_count, gross_amount FROM studio_dashboard_metrics_view WHERE studio_id = '<id>' ORDER BY month DESC LIMIT 3;` | Coincide con la UI. |

**Variantes a probar:**

- Registrar otro trabajo de otro mes → la tabla mensual ahora tiene 2 filas.
- Registrar otro trabajo del mismo artista → su fila en performance refleja jobs=2 y se actualiza el avg_ticket.
- Borrar el único trabajo → la vista se vacía pero NO falla.

---

### 3.6 Flujo "Sumo sponsors a mi estudio"

**Actor:** Estudio.
**Verifica:** Phase E (suppliers · inventory · sponsors).
**Tiempo estimado:** 8–10 min.

| # | Paso | Resultado esperado |
| --- | --- | --- |
| 1 | Tab "Proveedores" → "+ Nuevo proveedor" | Editor con nombre, categorías, email, teléfono, web, notas. |
| 2 | Crear: `Bishop Rotary`, categorías `máquinas, agujas`, email, web → "Guardar" | "Proveedor guardado." Aparece en la lista. |
| 3 | Tab "Inventario" → "+ Nuevo item" | Editor con nombre, SKU, categoría, unidad, stock inicial, reorder, costo, proveedor. |
| 4 | Crear: `Tinta Eternal Negra`, SKU `ETI-BLK-30`, categoría `tinta`, unidad `ml`, stock `500`, reorder `100`, costo `0.05`, currency `USD`, proveedor `Bishop Rotary` → "Guardar" | "Item guardado." Aparece en la lista. |
| 5 | En la fila del item, click "Movimiento" → editor de movimiento | Form con tipo (restock/consumo/pérdida/ajuste), cantidad, artista (lista los miembros activos), notas. |
| 6 | Tipo `Consumo`, cantidad `15`, artista del roster, nota "Sesión de María 27/04" → "Registrar" | "Movimiento registrado." El stock del item ahora es `485` (trigger `apply_inventory_movement` lo bajó). |
| 7 | Verificación DB: `SELECT quantity_on_hand FROM studio_inventory_items WHERE sku='ETI-BLK-30';` | Devuelve `485`. |
| 8 | Verificación DB: `SELECT kind, quantity, related_artist_user_id FROM studio_inventory_movements WHERE item_id = '<id>' ORDER BY performed_at DESC LIMIT 1;` | Devuelve `kind='consumption'`, `quantity=15`, artista correcto. |
| 9 | Tab "Sponsors" → "+ Nuevo sponsor" | Editor con nombre, tier, logo, web, vigencia, monto, "mostrar en perfil público". |
| 10 | Crear: `Bishop Rotary`, tier `gold`, logo URL pública, fechas, monto `500 USD`, "mostrar público" marcado → "Guardar" | "Sponsor guardado." Aparece en la lista. |
| 11 | Visitar el perfil público del estudio (`/studio/profile/?studio=<slug>`) | Aparece la sección "Sponsors" con la marca creada, tier, logo si existe y artistas asociados si fueron seleccionados. |
| 12 | Verificación DB: `SELECT kind, COALESCE(SUM(quantity), 0) AS total FROM studio_inventory_movements WHERE related_artist_user_id = '<user_id>' AND kind='consumption' GROUP BY kind;` | Devuelve la suma total consumida por ese artista. |

**Variantes a probar:**

- Registrar un movimiento de `restock` con cantidad `200` → stock vuelve a subir.
- Inventory health view: `SELECT name, quantity_on_hand, reorder_level, needs_reorder FROM studio_inventory_health_view WHERE studio_id = '<id>';` — items con stock < reorder aparecen con `needs_reorder = true`.
- Borrar un movimiento → el trigger revierte la cantidad.

---

## 4. Pruebas atómicas por superficie

Si encontrás un bug, repetí solo el caso afectado.

### 4.1 `/studio/login`

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| LOG-01 | Login OK con email/password válidos | Redirige a `/studio/dashboard`. |
| LOG-02 | Password incorrecta | Mensaje "Invalid login credentials" en rojo, no redirige. |
| LOG-03 | Email que sí existe pero NO tiene `studios.user_id` asociado (cuenta de artista, p.ej.) | Mensaje "Esta cuenta no es de un estudio" y desconecta automáticamente. |
| LOG-04 | "Recuperar acceso" sin email cargado | Mensaje "Escribí tu email primero". |
| LOG-05 | "Recuperar acceso" con email válido | Mensaje "Te mandamos un email…" (si Supabase auth está configurado). |

### 4.2 `/studio/register`

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| REG-01 | Wizard completo end-to-end (ver flujo 3.1) | Studio creado, sedes creadas, redirige al dashboard. |
| REG-02 | Email duplicado | Mensaje "Ya existe una cuenta con ese email." |
| REG-03 | Password < 8 caracteres | "La contraseña debe tener al menos 8 caracteres." |
| REG-04 | Passwords distintas | "Las contraseñas no coinciden." |
| REG-05 | Paso 3 sin sede con dirección Google | "Agregá al menos una sede con dirección completa." |
| REG-06 | Refresh del navegador a la mitad del wizard | El wizard se reinicia (los campos vacíos). El usuario ya creado en auth queda huérfano si la primera mitad pasó — caso conocido. |

### 4.3 `/studio/dashboard`

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| DASH-01 | Tab Perfil → editar bio + guardar | "Perfil actualizado." Bio nueva persiste al recargar. |
| DASH-02 | Tab Sedes → "Agregar sede" → llenar dirección Google → "Guardar" | "Sede guardada." Aparece en la lista. |
| DASH-03 | Tab Sedes → marcar otra sede como primary → "Guardar" | La sede previa pierde el `is_primary`; la nueva lo gana. `studios.primary_location_id` se actualiza. |
| DASH-04 | Tab Spots → crear como `draft` | Aparece con status `draft`, NO visible en `/studio-spots` público. |
| DASH-05 | Tab Spots → "Publicar" un draft | Status pasa a `open`, aparece en el público. |
| DASH-06 | Tab Spots → cerrar un spot abierto → recargar | Status `closed`. Las apps existentes quedan; el público no lo ve más. |
| DASH-07 | Tab Roster → cambiar split de un miembro a `65` → "Guardar" | Persiste al recargar. |

### 4.4 `/studio/profile/?studio=<slug>`

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| PROF-01 | Visitar con un slug existente (ej. `palermo-tattoo-club`) | Render completo: cover, bio, mapa con N pins (uno por sede activa), roster cards. |
| PROF-02 | Visitar con `?studio=` vacío | Mensaje "Falta el parámetro ?studio=…". |
| PROF-03 | Visitar con un slug inexistente | "Estudio no encontrado." |
| PROF-04 | Visitar como anónimo | Carga sin pedir login (RLS permite SELECT público). |

### 4.5 `/studio-spots`

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| SPT-01 | Visitar sin sesión | Lista renderiza, modal pide "Ingresá para postular". |
| SPT-02 | Filtrar por "Residencias" | Solo aparecen spots con kind=resident. |
| SPT-03 | Postular siendo artista nuevo | "Postulación enviada". |
| SPT-04 | Reaplicar al mismo spot | Mensaje "Ya aplicaste a este spot. Estado: pending." |
| SPT-05 | Postular siendo cliente (no artista) | "Solo cuentas de artista pueden postular." |

### 4.6 `/artist/invitations`

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| INV-01 | Sin sesión | Redirige a `/artist/login?returnTo=/artist/invitations`. |
| INV-02 | Con invitación pendiente | Aparece la card del estudio con botones "Aceptar" / "Rechazar" / "Ver perfil". |
| INV-03 | Click "Aceptar" | La invitación pasa a Memberships activas. Recarga. |
| INV-04 | Click "Salir" en una membership activa | Confirm + se marca `ended`. |

---

## 4.7 Subida de archivos a Storage (v1.1)

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| UP-01 | Dashboard Perfil → click "Subir archivo" en cover → elegir un PNG/JPG | El archivo sube, aparece preview, el campo URL se llena con la `publicUrl` de Supabase. Click "Guardar cambios" persiste. |
| UP-02 | Dashboard Perfil → "Galería del estudio" → seleccionar 3 imágenes a la vez | Las 3 suben, aparecen como tiles. Click "Guardar cambios" → el array `photo_feed_items` en `studios` se actualiza. |
| UP-03 | Dashboard Perfil → tile de la galería → click la X | El tile desaparece. Click "Guardar cambios" → la imagen sale del array. (El archivo en Storage queda — limpieza es manual o vía un job posterior.) |
| UP-04 | Dashboard Operaciones → Documentos → "+ Nuevo documento" → "Subir archivo" → PDF | Bucket `studio-documents` (privado). El archivo se asocia al doc con `file_url`. Click el archivo desde la lista → abre el PDF (autenticado). |
| UP-05 | Intentar subir un archivo > 10 MB en `studio-photos` | Rechazado por el bucket (`file_size_limit = 10485760`). El uploader muestra error. |
| UP-06 | Intentar subir un EXE como photo | Rechazado por `allowed_mime_types`. |
| UP-07 | Como anónimo: `SELECT * FROM storage.objects WHERE bucket_id = 'studio-documents' LIMIT 1;` | 0 filas (RLS). |
| UP-08 | Logueado como Estudio A: subir un objeto al folder `<estudio-B-id>/...` directamente vía API | Falla por las policies `studio_*_owner_insert/update/delete`, que delegan en `can_manage_studio_storage_path(bucket_id, name)`. |

## 4.8 Notificaciones por email (v1.1)

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| NOT-01 | `curl POST /api/studio/notify -d '{}'` | 400 con mensaje `"kind invalido (esperado: spot_decision \| roster_invite)"`. |
| NOT-02 | `curl POST /api/studio/notify -H "Authorization: Bearer <token>" -d '{"kind":"spot_decision","decision":"maybe","application_id":"<uuid>"}'` | 400 con `"decision invalida"`. |
| NOT-03 | `curl POST /api/studio/notify -d '{"kind":"spot_decision","application_id":"<uuid>","decision":"accepted"}'` sin Bearer | 401 con `"Authentication required"`. |
| NOT-04 | Con Bearer de otro estudio y `application_id` válido de Estudio A | 403 con `"Studio ownership required"`. |
| NOT-05 | Con Bearer del estudio dueño y `decision='accepted'` | `{"success":true,"sent":<bool>,"payload_kind":"studio_spot_decision"}`. Si `N8N_WEBHOOK_URL` no está set, `sent=false` y se loguea solo metadata no sensible. |
| NOT-06 | Lo mismo con `decision='rejected'` | El payload usa el subject `"Actualización de tu postulación a <Estudio>"` y un body más neutro. |
| NOT-07 | `curl POST /api/studio/notify -H "Authorization: Bearer <token-dueno>" -d '{"kind":"roster_invite","membership_id":"<uuid>"}'` | `{"success":true,"sent":<bool>,"payload_kind":"studio_roster_invite"}`. |
| NOT-08 | Aceptar una postulación desde `/studio/dashboard` → tab Spots → "Postulaciones" → "Aceptar" | UI muestra "¡Aceptado y sumado al roster! (email enviado al artista)". El frontend manda el access token de Supabase. |
| NOT-09 | Invitar un artista desde tab Roster | UI muestra "Invitación enviada. Le mandamos un email al artista." |
| NOT-10 | Si el endpoint `notify` falla por cualquier motivo → la acción de DB **no** se revierte | El membership o la decisión quedan persistidos; el log muestra el warning de notify pero la UI no rompe. |

### Configuración para producción

Para que los emails se envíen de verdad, agregar al `.env`:

```bash
N8N_WEBHOOK_URL=https://tu-n8n.com/webhook/studio-notifications
```

El payload que recibe n8n incluye:

```json
{
  "kind": "studio_spot_decision",
  "decision": "accepted",
  "to": "artista@email.com",
  "to_name": "Daniela Gomez",
  "from_name": "Palermo Tattoo Club",
  "subject": "¡Te aceptaron en Palermo Tattoo Club!",
  "body_text": "Hola Daniela, ...",
  "links": { "studio_profile": "...", "invitations": "...", "spots_directory": "..." },
  "meta": { "application_id": "...", "studio_id": "...", "spot_id": "...", ... }
}
```

n8n se encarga del routing al servicio de email (Gmail, SendGrid, SES, etc.) usando el flow que ya tienen para reset password.

---

## 5. Validaciones de seguridad (RLS)

Estas pruebas se hacen vía SQL editor de Supabase con distintas sesiones. Saltarse RLS sería un bug crítico.

### 5.1 Aislamiento entre estudios

| ID | Test | Resultado esperado |
| --- | --- | --- |
| RLS-01 | Logueado como Estudio A: `SELECT * FROM studio_jobs_log WHERE studio_id = '<estudio-B-id>';` | Devuelve 0 filas, aun si Estudio B tiene jobs. |
| RLS-02 | Logueado como Estudio A: `INSERT INTO studio_invoices (studio_id, ...) VALUES ('<estudio-B-id>', ...)` | Falla con violación de policy. |
| RLS-03 | Logueado como Estudio A: `UPDATE studio_locations SET label='hack' WHERE studio_id = '<estudio-B-id>';` | 0 filas afectadas. |

### 5.2 Aislamiento artista vs estudio

| ID | Test | Resultado esperado |
| --- | --- | --- |
| RLS-04 | Logueado como artista: `SELECT * FROM studio_jobs_log WHERE artist_user_id = auth.uid();` | Solo ve sus propias filas. |
| RLS-05 | Logueado como artista: `UPDATE studios SET name='hack' WHERE id = '<estudio-en-su-roster>';` | 0 filas afectadas (el artista NO puede editar el estudio). |
| RLS-06 | Logueado como artista: `INSERT INTO studio_artist_memberships (...) VALUES (...);` con `artist_user_id` distinto al suyo | Falla. |

### 5.3 Acceso público

| ID | Test | Resultado esperado |
| --- | --- | --- |
| RLS-07 | Sin sesión: `SELECT * FROM studios LIMIT 5;` | Devuelve 5 filas (públicas). |
| RLS-08 | Sin sesión: `SELECT * FROM studio_spots WHERE status='draft';` | 0 filas (drafts no son públicos). |
| RLS-09 | Sin sesión: `SELECT * FROM studio_jobs_log;` | 0 filas (jobs nunca son públicos). |
| RLS-10 | Sin sesión: `SELECT * FROM studio_artist_memberships WHERE status='active';` | Solo activas (otras políticas las ocultan). |
| RLS-11 | Sin sesión: `SELECT * FROM studio_public_sponsors_view WHERE studio_id='<id>';` | Devuelve solo columnas públicas de sponsors. |
| RLS-12 | Sin sesión: `SELECT * FROM studio_sponsors WHERE is_public=true;` | 0 filas o denegado por RLS; el acceso público debe ir por `studio_public_sponsors_view`. |

---

## 6. Smoke test rápido (15 min)

Si solo querés saber "¿está vivo todo el sistema?", corré esta lista en orden y deberías ver todo OK.

1. **HTTP smokes** (1 min): que devuelvan `200`:
   ```bash
   for r in /studio/login/ /studio/register/ /studio/dashboard/ /studio/profile/?studio=palermo-tattoo-club /studio-spots/ /artist/invitations/ /explore/; do
     curl -s -o /dev/null -w "$r %{http_code}\n" "http://localhost:4545$r"
   done
   ```
2. **DB smokes** (2 min): copiá esto al SQL editor:
   ```sql
   SELECT 'studios', COUNT(*) FROM studios
   UNION ALL SELECT 'locations',          COUNT(*) FROM studio_locations
   UNION ALL SELECT 'memberships',        COUNT(*) FROM studio_artist_memberships
   UNION ALL SELECT 'spots',              COUNT(*) FROM studio_spots
   UNION ALL SELECT 'metrics_view_works', (SELECT COUNT(*) FROM studio_dashboard_metrics_view)::int;
   ```
   Esperado: studios ≥ 25, locations ≥ 25, memberships ≥ 17, spots ≥ 2, metrics_view_works ≥ 0 (no error).
3. **Mapa público** (3 min):
   - Abrir `/explore`. Verificar que carga, que aparecen ~60 pines de precio + ~25 pines azules de estudios.
   - Click en un pin azul → abre el perfil del estudio en otra pestaña.
4. **Perfil público de un estudio rico** (1 min):
   - Abrir `/studio/profile/?studio=palermo-tattoo-club`. Verificar que el mapa muestra 3 pins numerados, hay 3 cards de roster, hay fotos.
5. **Directorio público de spots** (2 min):
   - Abrir `/studio-spots`. Verificar 2 cards.
   - Click una → modal con detalles + CTA "Ingresá para postular" (sin sesión).
6. **Login/dashboard del estudio** (3 min):
   - Login con la cuenta del flujo 3.1 (o crear una nueva al instante).
   - Recorrer las 9 tabs del dashboard: cada una debería renderizar (puede estar vacía pero NO con errores).
7. **Console clean** (3 min): abrir DevTools → Console en cada página visitada. Cero errores rojos. Algún 404 de favicon es benigno.

---

## 7. Datos de prueba que ya existen

Si querés probar sin crear nada, podés usar estos puntos de entrada precargados:

- **Estudio rico para probar lectura pública:** `/studio/profile/?studio=palermo-tattoo-club`
- **Otros estudios listos para visualizar en el mapa:** `bang-bang-nyc`, `east-side-ink`, `inkmania-berlin`, `sang-bleu-london`, `tinta-negra`, `bellavista-tattoo`, etc.
- **Spots abiertos para postular:**
  - `Guest spot · Buenos Aires · 4 semanas` (Palermo Tattoo Club).
  - `Residency · NYC · 3 a 6 meses` (Bang Bang NYC).
- **Artistas con membership activa visibles en el roster de Palermo:** Lucia Fernandez, Andres Perez, Ana Ruiz.

Todos estos vinieron del seed de Phase A y se mantienen consistentes a través de las fases B–F.

---

## Apéndice A — ¿Cómo decidir si una fase está OK?

Una fase pasa cuando:

1. **Su flujo end-to-end (sección 3.x)** se completa sin errores en consola.
2. Las **filas en la BD** se crean/actualizan/borran como se espera (los SQL de verificación de cada paso).
3. **RLS** no permite que un actor distinto al dueño vea o cambie datos ajenos (sección 5).
4. Visualmente, el render coincide con el estilo Bauhaus (tipografía Archivo Black + IBM Plex Mono, pins rectangulares, sombras de 3px+, rojo `#E23E28`, amarillo `#F4B942`, fondo `#F2F0E9`).

Si los 4 puntos pasan en una fase, esa fase está lista para producción.

---

## Apéndice B — Cuándo pedir ayuda

- Si **alguna migration fallara al re-aplicar** → problemas con un trigger o constraint duplicado. La estrategia es DROP IF EXISTS antes de CREATE; si igual falla, copiar el error y revisar.
- Si **el wizard de register se queda colgado en Paso 5** → probablemente la Address Picker no recibió Google Places (chequear que la API key esté en `window.CONFIG.googleMaps.apiKey`).
- Si **RLS rechaza una operación que debería funcionar** → revisar `auth.uid()` real con `SELECT auth.uid();` en una sesión de prueba; muchas veces el problema es que la cuenta usada NO tiene un `studios.user_id` linkeado.
