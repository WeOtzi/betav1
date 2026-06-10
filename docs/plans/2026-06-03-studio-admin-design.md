# Backoffice — Administrador completo de Estudios

**Fecha:** 2026-06-03
**Estado:** Implementado (2026-06-03)

## Objetivo

Convertir la vista de Estudios del backoffice en un **administrador completo**: editar
marca con **subida de imágenes** (logo, portada, galería) directo al bucket de Supabase,
gestionar **sedes**, **spots libres** + postulaciones, **roster** de artistas, y los
módulos de **operaciones** (inventario, proveedores, facturas, patrocinadores, documentos).

Decisiones (confirmadas con el usuario):
- **Alcance:** Todo + operaciones.
- **Subida de imágenes:** reusar `WeOtziUploader` (sube desde el navegador al bucket; la
  sesión superadmin tiene permiso por RLS vía `support_users_db`). La URL pública se guarda
  en la BD a través de los endpoints del servidor (service-role).
- **Interfaz:** vista de detalle a página completa (sección `#section-studio-detail`).

## Inventario de funciones (modelo de datos)

- **Cuenta/identidad** (`studios`): name, slug, email (login), reset password, is_active,
  is_verified, profile_complete, user_id.
- **Marca** (`studios`): tagline, bio, languages[], founded_year, **logo_image** 🖼️,
  **cover_image** 🖼️, **photo_feed_items** (JSONB galería) 🖼️🖼️.
- **Contacto** (`studios`): instagram, tiktok, whatsapp, contact_phone, phone, website.
- **Sedes** (`studio_locations`, N): label, is_primary, is_active, dirección completa,
  geo (lat/lng/place_id), phone, hours_json.
- **Spots** (`studio_spots`, N): title, kind, description, styles_wanted[], experience_min,
  language_requirements[], includes_housing, revenue_split_pct, stipend, fechas, semanas,
  status, cover_image 🖼️, location_id; **postulaciones** (`studio_spot_applications`).
- **Roster** (`studio_artist_memberships`, N): artist_user_id, role, revenue_split_pct,
  status, location_id, fechas.
- **Operaciones**: `studio_inventory_items` (+movements), `studio_suppliers`,
  `studio_invoices` (+items), `studio_sponsors` (+sponsor_artists), `studio_documents`,
  `studio_jobs_log`.

## Tipo de campo por dato

- Texto / número / textarea / select / toggle / fecha / tags(CSV→array): según columna.
- **Imagen única → bucket:** logo, portada, cover de spot → `WeOtziUploader.attach`.
- **Galería → bucket:** fotos del estudio (`photo_feed_items`) → `WeOtziUploader.attachGallery`.
- **Sub-tablas (repeater):** sedes, spots, roster, postulaciones, operaciones.

## Arquitectura (DRY)

Reutiliza el gate superadmin (`verifyAdminCaller`) y el service-role server-side. En vez de
escribir endpoints dedicados por cada tabla hija, se generaliza:

**Backend (`server.js`) — cambios mínimos:**
1. Extender `GET /api/admin/database/tables/:table` con filtro opcional
   `?filterColumn=&filterValue=` y `?order=` (col validada con `SAFE_COLUMN_RE`).
   → lista hijos por `studio_id` o postulaciones por `spot_id`.
2. Añadir `POST /api/admin/database/tables/:table/row` (INSERT genérico) `{ values }`.
   (UPDATE/DELETE genéricos ya existen.)
3. `studios` editable: añadir `photo_feed_items` a `STUDIO_EDITABLE_COLUMNS`.
   (PATCH/`delete-studio` de studios ya existen.)

**Frontend (`admin.js` + `index.html` + `admin-styles.css`):**
- Cargar `weotzi-uploader.js`; portar estilos `.wo-uploader*` al tema admin.
- `#section-studio-detail`: header (logo, nombre, estado, ← Volver) + pestañas
  `General · Imágenes · Contacto · Sedes · Spots · Roster · Operaciones`.
- Núcleo (General/Imágenes/Contacto/Sedes/Spots/Roster): formularios a medida que llaman a
  los endpoints (studios PATCH dedicado + genéricos para hijos). Imágenes vía WeOtziUploader.
- Operaciones: cada tabla hija renderizada como tabla filtrada por `studio_id`, reutilizando
  el editor de filas genérico (`editTableRow`/`deleteTableRow`) + alta vía INSERT genérico.

**Notas:**
- La subida usa el cliente Supabase del navegador (sesión superadmin). La escritura en BD
  pasa por el servidor (service-role) para mantener la consistencia y el gate.
- Sedes usan campos de dirección planos (como el modal de artista); el autocompletado de
  Google Places queda como mejora futura para no acoplar Maps al backoffice.
- "Sede principal" única: al marcar una, se desmarcan las otras (PATCH previo) por el índice
  único parcial `idx_studio_locations_one_primary`.

## Verificación
- `node --check` en server.js/admin.js; suite `node --test tests/*.test.js`.
- El server corre con `npm run dev` (nodemon) → auto-reload; probar en /backoffice con sesión
  superadmin contra el proyecto Supabase activo.
