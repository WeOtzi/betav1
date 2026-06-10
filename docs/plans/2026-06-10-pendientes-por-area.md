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

### ✅ RESUELTO 2026-06-10 (tarde): contraseñas en texto plano + hardening
- **CRÍTICO encontrado y eliminado**: `artists_db.password` almacenaba contraseñas
  en texto plano legibles con la anon key (3 cuentas expuestas, verificado vía API
  REST). Valores anulados de inmediato, columna eliminada
  (`20260610210000`), y todo el código del "espejo" removido (server.js,
  lib/artist-registration.js, dashboard.js, register.js, support-dashboard.js).
  Soporte sigue pudiendo ASIGNAR contraseñas temporales vía
  `/api/auth/reset-temp-password`; ya nunca se muestran ni persisten.
  **⚠️ Rotar las contraseñas de las 3 cuentas que estuvieron expuestas**:
  lalal3647@gmail.com, isainazar24@gmail.com, prueba@prie.com.
- `handle_new_user` ya NO crea fila de artista para signups de cliente/estudio
  (misma migración). A la fecha no había filas contaminadas (verificado: 0
  solapamientos artists/clients/studios).
- 62 funciones sin `search_path` fijo → todas fijadas a `public, extensions`
  (`20260610220000`, quedan 0; se excluyen las ~120 de pgvector que gestiona la
  extensión).
- 6 buckets públicos permitían enumerar archivos como anon → listado restringido
  a autenticados (`20260610230000`); descargas por URL pública intactas
  (verificado HTTP 200).

### Pendiente manual (dashboard de Supabase)
1. ✅ **Upgrade de Postgres** — hecho (2026-06-11).
2. **Protección de contraseñas filtradas** (HaveIBeenPwned) — requiere plan Pro;
   en desarrollo usamos Free. **Habilitarla al migrar a Pro / producción.**

### ✅ RESUELTO 2026-06-11: backlog menor (políticas USING(true) + superficie definer)
Migraciones `drop_dashboard_ddl_functions` + `20260611000000_harden_minor_backlog`,
verificadas con anon key (10/10 checks) y suite 109/109:
- **CRÍTICO encontrado**: `dashboard_update_trigger_function` ejecutaba SQL
  arbitrario (`EXECUTE p_definition`) como SECURITY DEFINER e invocable por
  **anon** = control total de la BD para cualquiera con la anon key. Eliminada
  junto con `dashboard_manage_trigger` y `dashboard_get_triggers` (restos del
  "Database Dashboard" borrado; ningún código las usaba).
- `session_logs` (2,778 filas con email/teléfono/IP/fingerprint) era legible por
  cualquiera → lectura solo soporte; vistas `analytics_*` a `security_invoker`.
- Chats de soporte (289 conversaciones) eran legibles/escribibles por cualquiera
  → lectura/edición solo soporte. El widget anónimo pasó de Realtime a polling
  vía `GET /api/support-chat/poll` (service role); el dashboard de soporte
  conserva lectura directa y Realtime (pasa `is_support_user()`).
- Catálogos/config escribibles por cualquiera → escritura solo soporte:
  `tattoo_styles`, `app_settings`, `tools_site_config` (el backoffice superadmin
  sigue funcionando vía `is_support_user()`).
- Vistas de estudio (definer, sin filtro por dueño) ya no son legibles por anon.
- `quotation_status_history` visible solo para las partes + soporte;
  `quotation_surveys` y `verification_history` fuera del alcance anon;
  `support_users_db` solo fila propia o soporte.
- Módulo feedback: `feedback_tickets`, `ticket_assignments`, `ticket_comments`
  eliminadas (0 filas, sin código).
- RPCs definer revocadas para anon/authenticated: chatbot legacy
  (`upsert_web_chat_quotation`, `generate_web_chat_quote_id`,
  `expire_old_job_board_requests`) y todas las funciones de trigger. Quedan
  públicas solo `check_email_registered` e `is_support_user`.

### Backlog menor restante
- **Si se revive el chatbot de n8n**: configurar su credencial Supabase con la
  service key (las RPCs del chat web ya no aceptan anon).
- Vistas de estudio: convertir a `security_invoker` cuando se retome el área
  (hoy siguen definer sin acceso anon; un usuario autenticado cualquiera aún
  podría leer métricas de otros estudios).
- Política `Allow update own logs` de `session_logs` sigue `USING(true)` — la
  mitiga que las lecturas están cerradas y los ids son aleatorios; afinar si se
  rediseña la telemetría.

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
