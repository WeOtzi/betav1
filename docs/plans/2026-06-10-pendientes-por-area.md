# Pendientes por área — revisión del 2026-06-10

Resultado de la revisión conjunta del trabajo en curso (limpieza de junio 2026).
Estado verificado contra: suite de tests (111/111 en verde), base de datos viva
(`flbgmlvfiejfttlawnfu`) y pruebas manuales de scripts.

## Seguridad (prioridad alta)

- **RLS deshabilitado en 8 tablas** del esquema público: `quotations_db` (192 filas),
  `clients_db` (102 filas), `quotations_attachments`, `quotation_flow_config`,
  `conversation_history`, `pending_messages`, `body_parts`, `pending_images`.
  Cualquiera con la anon key (pública por diseño) puede leer y modificar todas las filas,
  incluyendo datos personales de clientes y cotizaciones.
  **No** habilitar RLS sin diseñar las políticas primero: el flujo de cotización del
  chatbot escribe con anon key y se rompería. Tarea: mapear qué rol necesita qué
  operación por tabla, escribir políticas y habilitar RLS en una migración.

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
