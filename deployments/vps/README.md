# Beta en el VPS (Easypanel)

> **Estado (2026-11-19): en paralelo.** El servicio `beta` ya corre en el VPS (adoptado y con el deployer encendido), con los jobs apagados. Los usuarios siguen en el hosting compartido de Hostinger (`deployments/hostinger/RELEASE-RUNBOOK.md`) hasta el corte de DNS descrito abajo. Plan y decisiones: `docs/plans/2026-11-18-migracion-beta-vps.md`.

## Cómo funciona

```
push a main ─▶ «Verify delivery» (verify.yml)
                 └─ job «Tests and release policy» en verde
                        │
                        ▼
              «Publish beta image» (publish-image.yml)
                 exporta los archivos permitidos (export-image-context.cjs),
                 construye deployments/vps/Dockerfile, prueba que arranque
                 publica ghcr.io/weotzi/betav1:sha-<sha> (+ :main si sigue siendo la punta)
                 y deja el digest en la anotación «beta-image-digest» del job
                        │
                        ▼   (el VPS consulta la API pública; GitHub no entra al VPS)
              VPS · timer weotzi-beta-deployer (cada minuto)
                 0) si el servicio corre otra imagen que la registrada → la vuelve a fijar
                 1) punta de main + «Tests and release policy» aprobado
                 2) digest anotado por «Publish beta image» (workflow_run desde main)
                 3) docker pull …@sha256:<digest> y etiqueta revision == sha
                 → docker service update --image …@sha256:<digest> (start-first, gracia 25 s)
                 → /api/release por Traefik local con commit == sha
                 → si falla: bloquea ese commit y vuelve a la anterior
```

- **Servicio:** proyecto Easypanel `we-otzi-app`, servicio `beta` (en Swarm: `we-otzi-app_beta`), puerto interno 4545, 1 réplica.
- **Imagen:** `ghcr.io/weotzi/betav1` (paquete público; el código ya es público y la imagen no lleva secretos). Se despliega **por digest**, nunca por etiqueta: las etiquetas de GHCR se pueden reescribir y no prueban nada.
- **Variables secretas:** `/etc/weotzi/beta.env` en el host (dueño root, grupo 1000, modo 0440), montado como `/app/.env`. El proceso `node` del contenedor lo lee por el grupo pero no puede escribirlo. Nadie las tipea en Easypanel. `dotenv` no pisa lo que ya viene en el entorno del contenedor, así que las variables del panel mandan sobre el archivo.
- **«Deploy» desde el panel:** Easypanel vuelve a `:main`. En el minuto siguiente el deployer detecta la diferencia de digest y vuelve a fijar la versión registrada; los cambios de entorno o recursos hechos en el panel se conservan.
- **Apagado:** con SIGTERM la app deja de aceptar conexiones y espera hasta 20 s (`SHUTDOWN_GRACE_MS`) a las peticiones en curso; Swarm espera 25 s.
- **Estado del deployer:** `/var/lib/weotzi-deployer/state.json` (actual, anterior, bloqueo) e `history.jsonl`. Log en `/var/log/weotzi-deployer.log`.

## Servicio en Easypanel (`we-otzi-app` → `beta`)

| Sección | Valor |
|---|---|
| Fuente | Imagen Docker `ghcr.io/weotzi/betav1:main` |
| Entorno (no secreto) | `DEPLOYMENT_ENV=beta`, `RELEASE_ENVIRONMENT=beta`, `NODE_OPTIONS=--max-old-space-size=1536` y, solo durante las pruebas en paralelo, los interruptores de jobs (abajo) |
| Montajes | Bind: host `/etc/weotzi/beta.env` → contenedor `/app/.env` |
| Dominio | `beta.weotzi.com` → puerto 4545. **HTTPS apagado hasta el corte** (si no, Let's Encrypt falla en bucle mientras el DNS apunte al hosting viejo y puede bloquear el certificado una hora). |
| Recursos | Reserva 1024 MB / límite 2560 MB de memoria; sin límite de CPU (beta es lo prioritario) |
| Réplicas | 1 (la app asume instancia única: rate limits en memoria y jobs) |
| Puertos publicados | Ninguno (solo Traefik) |

Borrar el dominio `*.easypanel.host` que Easypanel crea solo, una vez terminadas las pruebas: la app arma URLs absolutas con el `Host` de la petición.

### Interruptores de jobs (pruebas en paralelo)

Mientras el hosting viejo siga activo, el VPS corre con estos valores en **Entorno** para no duplicar tareas:

`QUOTATION_EXPIRY_JOB=off` · `GCAL_SYNC_JOB=off` · `IMAGE_FP_JOB=off` · `TURNOS_HOLD_JOB=off` · `SESSION_REMINDERS_JOB=off` · `MOST_WANTED_INTERVAL_HOURS=0`

El vencimiento de sanciones y el barrido de Términos no tienen interruptor; correr en dos lados es tolerable (claims en base de datos). Los recordatorios de calendario solo corren si existe `CALENDAR_REMINDERS_INTERVAL_MS` (hoy no está en ningún lado). Al cortar, se quitan todos de **Entorno** y se redespliega.

### Pruebas en paralelo (antes del corte)

- Solo lectura en el navegador: `https://we-otzi-app-beta.jubcpl.easypanel.host` o `curl --resolve beta.weotzi.com:80:69.62.98.207 http://beta.weotzi.com/...`. Comparten la base de datos con beta.
- Los POST/PUT/PATCH/DELETE **desde el navegador** fallan con 500 en el dominio de prueba: CORS solo admite `https://beta.weotzi.com` (igual que en el hosting compartido). Las pruebas de escritura (login, registro, cotización, subidas) se hacen **después del corte**, en `https://beta.weotzi.com`.
- No completar registros ni reclamos de estudio en el dominio de prueba: los enlaces de los correos se arman con el `Host` y quedarían apuntando a un dominio que se borra.

## Diferencias con el hosting compartido

El cuerpo de las respuestas es el mismo (auditoría del 2026-11-19: 76 rutas, estáticos y APIs públicas). Lo que cambia es el borde, y la app lo compensa en `lib/edge-http.js` (2.7.2):

| Tema | Hostinger (proxy.php + LiteSpeed) | VPS (Traefik de Easypanel) | Cómo queda |
|---|---|---|---|
| IP del cliente | proxy.php reemplaza `X-Forwarded-For` | conserva el del cliente (`forwardedHeaders.insecure`, global) | la app usa `req.ip` (`trust proxy` 1) |
| Esquema (`X-Forwarded-Proto`) | lo fija proxy.php | también lo puede mandar el cliente | la app solo lo usa para cosas que el cliente ya controla (su propia respuesta, `secure` de una cookie); Traefik redirige a HTTPS |
| Compresión | brotli de LiteSpeed | ninguna | middleware `compression` |
| 502 de la app | pasa tal cual | Easypanel lo cambia por su página HTML (middleware `bad-gateway-error-page`, solo el status 502) | la app responde 504 |
| Conexiones | una nueva por petición | Traefik las reutiliza hasta 90 s | keep-alive de 95 s |
| `upgrade-insecure-requests` | lo agrega Hostinger | no | la app lo agrega en HTTPS |
| Lectura del cuerpo | sin corte | `readTimeout` 60 s (global, compartido con n8n) | límite conocido: solo afecta subidas de más de 60 s; las fotos van directo a Supabase |

## Primera instalación (root en el VPS)

1. **Swap** (si no hay): `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`, agregar `/swapfile none swap sw 0 0` a `/etc/fstab` y `sysctl vm.swappiness=10` (persistir en `/etc/sysctl.d/99-swap.conf`).
2. **Variables:** copiar `~/weotzi-deploy/shared/main.env` del hosting compartido **de servidor a servidor**, sin mostrarlo, a `/etc/weotzi/beta.env`, quitando el BOM y las claves `PORT`, `HOST`, `LISTEN_SOCKET` y `NGROK_*`. Verificar solo nombres: `cut -d= -f1 /etc/weotzi/beta.env`. Guardar además una copia fuera de línea en el gestor de secretos.
3. **Deployer:** copiar `deployments/vps/` al VPS y correr `bash install.sh` (deja el timer apagado).
4. **Imagen pública:** el paquete `betav1` hereda la visibilidad del repositorio público. Comprobar desde el VPS, sin `docker login`, que `docker pull ghcr.io/weotzi/betav1:sha-<commit>` funciona; si no, GitHub → Packages → `betav1` → Package settings → Change visibility → Public.
5. **Servicio** en Easypanel con la tabla de arriba. Después: `python3 /opt/weotzi-deployer/beta-deployer.py adopt` (comprueba el commit que responde, fija el servicio por el digest verificado y lo registra) y `systemctl enable --now weotzi-beta-deployer.timer`. Sin `adopt`, el timer no publica nada.

## Operación

```bash
python3 /opt/weotzi-deployer/beta-deployer.py status        # servicio, /api/release y estado
tail -n 50 /var/log/weotzi-deployer.log
python3 /opt/weotzi-deployer/beta-deployer.py rollback      # vuelve a la anterior y bloquea la punta de main
python3 /opt/weotzi-deployer/beta-deployer.py rollback --sha <sha>
python3 /opt/weotzi-deployer/beta-deployer.py resume        # quita el bloqueo (tras arreglar main)
python3 /opt/weotzi-deployer/beta-deployer.py deploy --sha <sha>   # publica un commit verificado
systemctl disable --now weotzi-beta-deployer.timer          # congela los deploys
```

- `rollback` sin `--sha` vuelve **una** versión y no ofrece volver a la que se dejó; para retroceder más, `rollback --sha <sha>`.
- `deploy --sha` de un commit que no es la punta bloquea la punta hasta `resume` (si no, el timer la volvería a publicar).
- Si GitHub tarda o limita las consultas (60/h sin token), el deployer reintenta con espera creciente hasta 15 min.
- Pruebas del deployer (Linux): `python3 -m unittest deployments/vps/test_beta_deployer.py -v`.
- Las migraciones **no** las corre el deploy (igual que antes): aplicarlas en el orden que pida cada entrega (`deployments/DEPLOY.md`).
- Logs de la app: Easypanel → `beta` → Logs (o `docker service logs we-otzi-app_beta`). Docker rota a 10 MB × 3.
- El deployer conserva las últimas 5 imágenes `sha-*` y la anterior en uso.

## Corte de DNS (una sola vez)

beta.weotzi.com manda HSTS de un año: un navegador que ya la visitó **no deja saltar** un certificado inválido. El certificado de Let's Encrypt (desafío HTTP-01) solo se puede emitir cuando el DNS ya apunta al VPS, así que hay unos minutos en que quien llegue al VPS ve un error TLS. Por eso: hora de poco tráfico, TTL bajo y HTTPS encendido apenas se cambia el registro (no antes: fallaría la validación y Let's Encrypt limita los reintentos).

1. Al menos 4 h antes (el TTL actual es de 4 h): TTL del registro `A beta` a 300 s. El DNS de `weotzi.com` se administra en Squarespace (Dominios → weotzi.com → DNS). No tocar el apex, `www`, `staging`, MX ni los registros de Google.
2. Congelar merges a main. Confirmar que VPS y hosting compartido están en el mismo commit (`/api/release`).
3. Aplicar en Easypanel los límites de los demás servicios (beta primero; reinicia cada servicio unos segundos).
4. **Desactivar** (no borrar) el cron del poller en hPanel.
5. Cambiar `A beta` → `69.62.98.207`. Esperar a que los servidores autoritativos respondan la IP nueva (`dig +short @ns-cloud-d1.googledomains.com beta.weotzi.com`, y d2–d4) y recién ahí encender HTTPS del dominio `beta.weotzi.com` en Easypanel. Mirar `docker service logs easypanel-traefik` hasta ver el certificado y comprobar: `openssl s_client -connect 69.62.98.207:443 -servername beta.weotzi.com </dev/null | grep issuer` (Let's Encrypt) y `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://beta.weotzi.com/` (301 o 308 a https).
6. Dejar viva la app vieja al menos dos TTL (10 min con 300 s): los resolvers que todavía tengan la IP vieja siguen llegando ahí. Recién entonces detenerla: `PM2_HOME=~/weotzi-deploy/pm2 ~/node_modules/pm2/bin/pm2 stop weotzi-beta` (en el compartido).
7. Quitar los interruptores de jobs en Easypanel y redesplegar. Confirmar en logs `[huellas]` (< 2 min) y `[gcal]` (< 15 min).
8. Pruebas de escritura en `https://beta.weotzi.com` (login, cotización de QA, imagen IA, subida grande) y borrar el dominio `*.easypanel.host`.
9. Vigilar 24–48 h; luego subir el TTL.

## Volver al hosting compartido (rollback de la migración)

1. Redesplegar el VPS **con los interruptores de jobs apagados** (que no corran en dos lados).
2. Revertir `A beta` → `92.112.189.44`.
3. En el compartido: `PM2_HOME=~/weotzi-deploy/pm2 ~/node_modules/pm2/bin/pm2 start ~/weotzi-deploy/processes/main.json --only weotzi-beta` y reactivar el cron de hPanel.
4. Detener el servicio del VPS cuando pase el TTL.

El hosting compartido se conserva intacto al menos 4 semanas después del corte.
