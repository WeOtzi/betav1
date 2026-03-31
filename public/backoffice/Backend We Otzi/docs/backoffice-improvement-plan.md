# We Otzi Backoffice — Plan de Mejoras Integral

**Fecha:** 2026-03-27
**Autor:** Isaí + Claude
**Objetivo:** Convertir el backoffice en una navaja suiza de administración del negocio

---

## EQUIPO DE AGENTES

### Integrantes

| Agente | Rol | Nivel |
|--------|-----|-------|
| **Accent** | Project Manager | Senior |
| **Woz** | Programador Senior FullStack — Experto en Backend | Senior |
| **Bill** | Programador Jr. Full Stack — Experto en Backend | Junior |
| **Sam** | Programador Jr. Full Stack — Experto en Backend | Junior |
| **Steve** | Programador Senior Frontend — Expertise en UI y UX | Senior |
| **Supa** | Experto en Bases de Datos y APIs | Senior |
| **Marq** | Tester | Senior |

### Estructura de Coordinación

- **Woz** planifica, delega, revisa y corrige todo lo que **Bill** y **Sam** le envíen. Es quien les asigna las tareas a ambos y coordina la ejecución, resultados y colaboración con los otros agentes.
- **Woz**, **Steve**, **Supa** y **Marq** reportan a **Accent**.
- **Accent** coordina a todos los agentes y recibe la información de todos. Accent lidera el proyecto, realiza la planificación y delega tareas a los demás agentes.
- **Marq** hace pruebas de cada sprint y verifica los reportes que genere cada agente de sus tareas para confirmar que se hayan cumplido, luego informa a **Accent**, quien hará los ajustes necesarios en el plan, coordinará tareas o dará seguimiento.

### Flujo de Reporte

```
Bill ──┐
       ├──▶ Woz ──┐
Sam ───┘           │
                   ├──▶ Accent (PM)
Steve ─────────────┤
Supa ──────────────┤
Marq ──────────────┘
```

---

## Resumen Ejecutivo

El backoffice actual tiene ~10 secciones funcionales (Dashboard, Cotizaciones, Artistas, Preguntas, Estilos, Config, Contenido, APIs, DB, Backup) construidas con Node.js + Express + Vanilla JS + Supabase. La auditoría reveló bugs críticos en queries, APIs sin configurar, problemas de seguridad, y ausencia de herramientas de monitoreo y analytics.

El plan se divide en **3 fases**: reparaciones críticas, mejoras a features existentes, y features nuevas de monitoreo.

---

## FASE 1: REPARACIONES CRÍTICAS

### 1.1 Bugs en Código

| # | Bug | Archivo | Severidad | Fix |
|---|-----|---------|-----------|-----|
| 1 | `closeConfirmModal()` no existe | shared-drawer.js:1617,1663 | CRÍTICA | Crear la función que cierra el modal de confirmación y limpia `_confirmQuoteData` |
| 2 | Query usa `quote_id` en vez de `id` para cargar adjuntos | quotations.js:232 | CRÍTICA | Cambiar `q.quote_id` → `q.id` en el map de IDs |
| 3 | Delete de cotización usa campo incorrecto | admin.js:707 | CRÍTICA | Cambiar `.eq('quote_id', quoteId)` → `.eq('id', quoteId)` |
| 4 | Estilos se muestran como `[object Object]` | admin.js:605 | MEDIA | Importar o replicar `getStyleDisplayName()` de quotations.js |
| 5 | Chat subscriptions no se limpian al cerrar drawer | shared-drawer.js:2058 | MEDIA | Agregar `unsubscribe()` en `closeDrawer()` |
| 6 | Flujo de estados incompleto | shared-drawer.js:2084-2089 | MEDIA | Expandir manejo de `client_rejected`, `in_progress`, `completed` |
| 7 | Sin validación en modal de edición de cotización | shared-drawer.js:1912 | BAJA | Agregar validación de campos requeridos antes de guardar |
| 8 | Sin null check en drawer content | shared-drawer.js:2041 | BAJA | Agregar verificación de que el elemento existe |

### 1.2 APIs Desconfiguradas

| Servicio | Estado | Acción |
|----------|--------|--------|
| EmailJS | Sin credenciales | Configurar o remover del health check |
| Google Calendar | Deshabilitado | Configurar OAuth2 o desactivar la sección |
| Health Checks | Solo verifica Supabase realmente | Implementar tests reales para TODAS las APIs |

### 1.3 Seguridad

| # | Problema | Severidad | Fix |
|---|----------|-----------|-----|
| 1 | Google Maps API key hardcodeada en frontend | ALTA | Mover a backend proxy o restringir key por dominio |
| 2 | Preset password en texto plano (`OtziArtist2025`) | ALTA | Mover a .env, no exponer en config público |
| 3 | Sin rate limiting en endpoints | ALTA | Instalar `express-rate-limit` en endpoints sensibles |
| 4 | Sin security headers | ALTA | Instalar `helmet.js` |
| 5 | localStorage almacena credenciales | MEDIA | Migrar a httpOnly cookies o session tokens |
| 6 | Sin CORS configurado | MEDIA | Configurar `cors()` con origins permitidos |
| 7 | `node-fetch` v2 deprecated | MEDIA | Actualizar a v3+ o usar fetch nativo de Node 18+ |

### 1.4 Dependencias Desactualizadas

| Paquete | Actual | Recomendado | Prioridad |
|---------|--------|-------------|-----------|
| node-fetch | 2.7.0 | 3.x+ o nativo | ALTA |
| express | 4.18.2 | 4.21+ | MEDIA |
| multer | 1.4.5-lts.1 | 2.x | MEDIA |
| googleapis | 134.0.0 | Última | BAJA |
| fs-extra | 11.3.3 | Última | BAJA |

---

## FASE 2: MEJORAS A FEATURES EXISTENTES

### 2.1 Dashboard del Backoffice → Centro de Comando

**Estado actual:** Stats cards básicos (total cotizaciones, pendientes, respondidas, artistas).

**Mejoras:**
- Gráficas de tendencia: cotizaciones por semana/mes, tasa de conversión (usar Chart.js o similar en vanilla JS)
- Widget de actividad reciente en tiempo real: nuevos usuarios, cotizaciones, aplicaciones al job board (Supabase realtime subscriptions)
- Health monitor de APIs con tests reales de conexión (latencia, status)
- Conteo de artistas: activos vs inactivos, verificados vs pendientes, por país
- Resumen de tickets de soporte abiertos con prioridad
- Indicador de sistema: uso de storage, sesiones activas

### 2.2 Cotizaciones → Flujo Completo

**Estado actual:** CRUD básico con estados parciales.

**Mejoras:**
- Corregir flujo de estados completo: pending → responded → client_approved → in_progress → completed (+ client_rejected, expired)
- Timeline visual del ciclo de vida de cada cotización en el drawer
- Métricas: tiempo promedio de respuesta, tasa de conversión por estilo/artista
- Filtros avanzados: por fecha, por artista asignado, por rango de precio
- Bulk actions: cambiar estado, exportar, archivar múltiples

### 2.3 Artistas → Gestión Profunda

**Estado actual:** Lista básica con edición inline.

**Mejoras:**
- Cálculo y display de "Artist Index" (completitud de perfil, tiempo de respuesta, rating, cotizaciones completadas)
- Vista de perfil completo desde el backoffice (modal con toda la info)
- Dashboard de artista: cotizaciones recibidas/completadas, earnings estimados
- Comparativas: artista vs promedio de la plataforma
- Filtros: por país, estilo, estado de verificación, actividad reciente

### 2.4 Sistema de Soporte → Proactivo

**Estado actual:** Dashboard funcional pero sin tiempo real.

**Mejoras:**
- Supabase realtime subscriptions para actualización automática
- Asignación de tickets a agentes de soporte
- Priorización automática (errores del ErrorReporter = alta prioridad)
- Métricas de SLA: tiempo promedio de resolución, tickets por agente
- Exportación de datos a CSV/Excel
- Historial de acciones por ticket

### 2.5 Job Board → Marketplace Bidireccional

**Estado actual:** Feed de solicitudes sin sistema de respuesta.

**Mejoras:**
- Sistema de bidding: artistas pueden proponer desde el feed
- Notificaciones de matches (estilo + ubicación + presupuesto)
- Tracking de popularidad de solicitudes
- Estado visible en el backoffice: solicitudes activas, expiradas, con artista asignado

### 2.6 Database Inspector → Query Builder

**Estado actual:** Vista de solo lectura sin filtros.

**Mejoras:**
- Filtros por columna (texto, rango numérico, fecha)
- Ordenamiento por cualquier columna
- Búsqueda global full-text
- Edición inline de registros (con confirmación)
- Visualización de relaciones (foreign keys)
- Exportación filtrada

---

## FASE 3: FEATURES NUEVAS DE MONITOREO

### 3.1 Microsoft Clarity — Behavior Tracking

**Implementación:**
- Agregar el script de Clarity (~2KB) en el `<head>` de todas las páginas públicas
- Dashboard de Clarity accesible desde el backoffice (link directo)
- Funcionalidades gratuitas incluidas: heatmaps, session recordings, scroll depth, rage clicks, dead clicks, engagement metrics, funnel analysis

**Configuración:**
1. Crear proyecto en clarity.microsoft.com
2. Obtener tracking code
3. Insertar en `public/shared/partials/head.html` o equivalente
4. Configurar filtros de privacidad (masking de inputs sensibles)

### 3.2 Panel de Analytics de Usuarios (nueva sección en sidebar)

**Datos a mostrar (extraídos de Supabase + Clarity):**
- Usuarios registrados por tipo (clientes vs artistas) con gráfica temporal
- Distribución de dispositivos (móvil/desktop, OS, navegador) — datos del `user_agent` en session_logs
- Países y ciudades — parsing del IP existente con servicio gratuito (ip-api.com) o campo `country` de artists_db/clients_db
- Usuarios nuevos vs recurrentes por período
- Páginas más visitadas (de session_logs.page_url)
- Sesiones con errores: cantidad, tendencia, páginas más problemáticas

### 3.3 Centro de Verificaciones (nueva sección en sidebar)

- Cola de solicitudes de verificación de artistas pendientes (filtrar artists_db por verification_status)
- Historial de verificaciones aprobadas/rechazadas
- Vista de perfil rápida del artista en la cola
- Acciones rápidas: aprobar/rechazar con un click + envío de notificación vía n8n webhook
- Notas internas por verificación

### 3.4 Monitor de Servicios Mejorado (reemplaza health check actual)

**Test real por servicio:**
- Supabase: query SELECT 1 + verificar storage bucket accesible
- Google Drive: verificar acceso al folder configurado
- Gemini: request de prueba con prompt mínimo
- n8n: ping al webhook (sin disparar acción)
- EmailJS: verificar credenciales válidas
- Google Maps: geocoding request de prueba

**Extras:**
- Historial de checks (guardar resultados en tabla de Supabase)
- Alertas visuales en el dashboard cuando un servicio falla
- Tiempo de latencia de cada servicio

### 3.5 Tickets de Soporte Centralizados (mejora de feedback_tickets en backoffice)

- Vista unificada de tickets manuales + auto-generados
- Asignación a agentes de soporte
- Categorización: bug, feature request, consulta, error automático
- Prioridad: crítica, alta, media, baja
- Métricas: tiempo de resolución, distribución por categoría, tendencia
- Historial de comunicación por ticket

---

## ORDEN DE IMPLEMENTACIÓN RECOMENDADO

### Sprint 1: Reparaciones Críticas (1-2 semanas)
1. Fix de bugs en shared-drawer.js, admin.js, quotations.js
2. Seguridad: helmet.js, express-rate-limit, CORS
3. Actualizar dependencias (node-fetch, express)
4. Fix de health checks reales
5. Mover secrets fuera del frontend

### Sprint 2: Clarity + Analytics Base (1 semana)
1. Integrar Microsoft Clarity
2. Crear sección de Analytics de Usuarios en sidebar
3. Parsear datos existentes de session_logs para métricas de dispositivo/país/página

### Sprint 3: Dashboard + Cotizaciones (1-2 semanas)
1. Dashboard como centro de comando (gráficas, actividad, health)
2. Flujo completo de estados de cotizaciones
3. Timeline visual en drawer
4. Métricas de cotizaciones

### Sprint 4: Artistas + Verificaciones (1 semana)
1. Artist Index calculation
2. Centro de verificaciones
3. Vista de perfil completo desde backoffice
4. Filtros avanzados

### Sprint 5: Soporte + Job Board + DB (1-2 semanas)
1. Tickets centralizados con asignación
2. Realtime en soporte
3. Job Board bidding system
4. Database Inspector mejorado

---

## ARQUITECTURA

**Stack (sin cambios):** Node.js + Express + Vanilla JS + Supabase + Microsoft Clarity

**Nuevas dependencias backend:**
- `helmet` — Security headers
- `express-rate-limit` — Rate limiting
- `cors` — CORS handling

**Nuevas integraciones frontend:**
- Microsoft Clarity (script tag)
- Chart.js o lightweight chart library (para gráficas en dashboard)

**Nuevas tablas Supabase sugeridas:**
- `service_health_logs` — Historial de health checks
- `verification_history` — Registro de verificaciones de artistas
- `ticket_assignments` — Asignación de tickets a agentes
- `ticket_comments` — Comunicación interna por ticket

---

## ARCHIVOS CLAVE A MODIFICAR

| Archivo | Cambios |
|---------|---------|
| `server.js` | Agregar helmet, rate-limit, cors, nuevos endpoints de health check |
| `public/shared/js/admin.js` | Fix bugs, mejorar dashboard, agregar analytics UI |
| `public/shared/js/shared-drawer.js` | Fix closeConfirmModal, timeline, flujo estados |
| `public/shared/js/quotations.js` | Fix query de adjuntos |
| `public/shared/js/config-manager.js` | Health checks reales |
| `public/backoffice/index.html` | Nuevas secciones en sidebar (Analytics, Verificaciones) |
| `public/shared/js/app-config.json` | Remover secrets, mover a .env |
| `package.json` | Actualizar deps, agregar helmet/cors/rate-limit |
| Todas las páginas públicas | Agregar script de Clarity |
