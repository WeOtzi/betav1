# Migración de beta al VPS (Easypanel)

**Estado:** en curso (2026-11-18). Runbook operativo: `deployments/vps/README.md`.

## Objetivo

Llevar `beta.weotzi.com` del hosting compartido de Hostinger al VPS Hostinger KVM 2 (São Paulo, Ubuntu 24.04 + Easypanel), proyecto `we-otzi-app`, sin perder datos ni funciones y manteniendo el dominio. En el mismo VPS siguen n8n, evolution-api, BillionMail y los servicios de `agents-ai`.

## Decisiones del dueño (2026-11-18)

1. **Construcción:** GitHub construye la imagen después de que pasa el CI y el VPS la descarga y publica (no se compila en el VPS; el panel de Easypanel no necesita quedar expuesto a GitHub).
2. **Previews** (`preview.weotzi.chat`, ramas `valentina/*`, caídas desde el 6 de noviembre): fuera de la migración por ahora.
3. **Recursos:** beta es lo prioritario; se le reserva memoria y se limita al resto. Swap de 4 GB.
4. **DNS:** el cambio del registro `beta` lo hace Claude desde el navegador del dueño, con confirmación antes de guardar.
5. `openclaw-gateway` (proyecto `agents-ai`) detenido, con sus datos conservados.

## Capacidad (medido el 2026-11-18)

Escenario: 50 artistas, 25 estudios, 200 clientes/mes, 5 cotizaciones diarias por artista (250/día) y uso normal.

- **Hoy la app:** 138–152 MB de RAM y < 1 % de CPU.
- **Estimado para el escenario:** 200–400 MB de RAM y picos de medio núcleo.
- **VPS:**
  - 2 vCPU y 7,8 GB de RAM, con 4,7 GB disponibles tras detener openclaw.
  - 68 GB de disco libres.
  - Latencia a Supabase de 22 ms: el proyecto está en São Paulo.
- **Veredicto:** alcanza con margen de 5–10× el escenario.
- **Qué se llena antes:** las cuotas del plan de Supabase (Storage y egress).
- **El riesgo real:** compartir la máquina con otros servicios. Se cubre con swap, la reserva de memoria para beta y los límites del resto.

## Hechos que condicionan el diseño

- **Estado:** todo vive en Supabase. `shared/public-uploads` y `public-storage` están vacíos y la app no escribe en disco (salvo `.env` si falta `CRON_API_TOKEN`).
- **Jobs:** corren dentro del proceso; no hay crons externos.
- **Seis jobs con interruptor:** `QUOTATION_EXPIRY_JOB`, `GCAL_SYNC_JOB`, `IMAGE_FP_JOB`, `TURNOS_HOLD_JOB`, `SESSION_REMINDERS_JOB` y `MOST_WANTED_INTERVAL_HOURS=0`.
- **Dos jobs sin interruptor:** sanciones vencidas y barrido de Términos.
- **Traefik de Easypanel:** publica 80/443 en modo `host`, así que `req.ip` es la IP real. Usa los timeouts por defecto: 60 s para leer la petición y sin límite para la respuesta.
- **Logs de Docker:** el VPS ya los rota (10 MB × 3).
- **`main.env` del compartido:** 30 claves con BOM y CRLF, sin duplicados. La primera, `PORT`, hoy queda ignorada por el BOM; en el VPS se descarta.
- **Copias viejas de credenciales en `public_html/beta`:** no se pueden descargar (403/404). Se borran después del corte y se rotan.

## Fases

1. **Preparación:**
   - Dockerfile, workflow «Publish beta image» y deployer (`deployments/vps/`).
   - Swap, variables en `/etc/weotzi/beta.env` y servicio en Easypanel con HTTPS apagado.
2. **Pruebas en paralelo:**
   - El VPS corre el mismo commit con los jobs apagados.
   - Se prueba por `--resolve` y el dominio `*.easypanel.host`: login, cotización QA, IA de más de 60 s, subida grande, huellas, gcal e integraciones salientes.
3. **Corte:**
   - TTL a 300 s con 48 h de anticipación; congelar main.
   - Límites al resto de servicios.
   - Apagar el cron de hPanel y cambiar `A beta`.
   - Encender HTTPS, detener pm2 viejo y quitar interruptores.
4. **Post-corte:**
   - 4 semanas con el compartido intacto como rollback.
   - Luego limpiar releases, cron, pm2 y credenciales viejas, y actualizar `DEPLOY.md`, `CLAUDE.md` y la memoria.
