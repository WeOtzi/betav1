# Pendientes por área — revisión del 2026-06-10

Resultado de la revisión conjunta del trabajo en curso (limpieza de junio 2026).
Estado verificado contra: suite de tests (111/111 en verde), base de datos viva
(`flbgmlvfiejfttlawnfu`) y pruebas manuales de scripts.

## Seguridad

### ✅ RESUELTO 2026-06-10: RLS habilitado en las 8 tablas expuestas
Migración `20260610200000_enable_rls_remaining_tables.sql` (aplicada en vivo y
verificada con la anon key contra la API REST):
- `quotations_db`: anon solo ve/edita borradores `in_progress`; clientes y artistas
  solo lo suyo; soporte/superadmin todo.
- `clients_db`: bloqueada para anon; el perfil se crea ahora en el trigger
  `handle_new_user` desde los metadatos del signUp (la confirmación de email está
  activa, así que el INSERT client-side corría sin sesión). El trigger también
  vincula cotizaciones huérfanas por email.
- `quotations_attachments` y `quotation_flow_config`: políticas nuevas (espejan la
  visibilidad del padre / lectura pública + escritura de soporte).
- `body_parts`: se eliminó "Public write access" (cualquiera podía editar el catálogo).
- `conversation_history`, `pending_messages`, `pending_images` (chatbot legacy, sin
  uso en el código): RLS sin políticas = solo service role.

**Cambio de comportamiento aceptado**: el prefill por email del wizard de cotización
(autocompletar datos de un email ya usado SIN login) ya no devuelve datos — ese
prefill ERA la fuga (cualquiera que tecleara un email ajeno obtenía whatsapp, fecha
de nacimiento y condiciones de salud). El cliente logueado sigue viendo todo lo suyo.

### Backlog de hardening (advisors de Supabase, preexistentes)
- 62 funciones sin `search_path` fijo (WARN).
- 28 políticas `USING (true)` señaladas (varias intencionales: lecturas públicas).
- Versión de Postgres con parches de seguridad pendientes → programar upgrade.
- Protección de contraseñas filtradas (HaveIBeenPwned) deshabilitada en Auth.
- 6 buckets públicos permiten listar archivos.

### Deuda detectada en el modelo de usuarios
- **`handle_new_user` crea una fila en `artists_db` para TODO usuario nuevo,
  incluidos clientes** (por eso artists_db tiene 110 filas). No se tocó porque hay
  flujos que pueden depender de ello, pero conviene separar: solo crear artists_db
  cuando `user_type` sea artista. Revisar impacto en artist-login/explore/marketplace.

## Áreas funcionales pero incompletas

### Globo 3D (`/explore/globe`)
- Funcional, pero la interfaz es confusa y está sobrecargada.
- Pendiente: rediseñar UI, mejorar animaciones y el globo en general.

### Rediseño de dashboard de artista (`dashboard-redesign.js/css`)
- Existe un diseño ya elegido; falta aplicarlo y mejorarlo.
- Relacionado con el área artista (abajo): se trabajan juntos.

### Área artista (invitaciones, visitantes, login, perfil/details, registro)
- Registro con borradores y barra de progreso: tests en verde.
- Invitaciones de estudio: la base de datos está lista (usa
  `studio_artist_memberships`, verificado con 47 filas vivas); falta diseñar la
  interfaz.
- Pendiente: rediseño general junto con el dashboard.

### Soporte + emails (chat de soporte, enrutamiento, BillionMail)
- Funcional pero incompleto.
- La rama `feature/billionmail-migration` (abril, respaldada en origin) se conserva
  como referencia hasta cerrar esta área.

### Backoffice
- Fallaba la conexión a las bases de datos — diagnosticar y arreglar.
- Mejorar el panel de estudios, la interfaz general y verificar todas las funciones.

### Perfil/dashboard de cliente (`/client/profile`)
- Mejorarlo para incorporar las reseñas verificadas y hacer un dashboard más completo.

## Áreas verificadas como funcionales (sin pendientes conocidos)

- **Estudios**: esquema aplicado con datos reales (25 estudios, 30 sedes, 47 roster,
  27 spots, 25 aplicaciones). Las tablas de operaciones (facturas, inventario,
  proveedores, sponsors) existen pero están vacías — construidas, aún sin uso.
- **Reseñas verificadas**: migraciones aplicadas con hardening (4 políticas RLS),
  305 filas vivas, tests de esquema y frontend en verde.
- **Pre-cotizador**: `npm run test:prequote` en verde, endpoint y estimador operativos.
- **Import de Instagram**: confirmado funcionando; tabla de auditoría con registros.

## Planes activos relacionados

- [2026-04-28-tarifas-dinamicas.md](2026-04-28-tarifas-dinamicas.md) — pausado con
  notas de reanudación; su rama `feature/dynamic-pricing` (2 migraciones) se conserva.
- [2026-06-03-studio-admin-design.md](2026-06-03-studio-admin-design.md) — diseño del
  admin de estudios.
