# Beta en el VPS (Easypanel)

> **Estado: en producción desde el 2026-11-19 15:52 (-03).** `beta.weotzi.com` apunta al VPS (`A beta` → `69.62.98.207`, TTL 300 s), con HTTPS de Let's Encrypt y todos los jobs encendidos. El hosting compartido de Hostinger (`deployments/hostinger/RELEASE-RUNBOOK.md`) queda como respaldo con los jobs apagados en su `.env` (ver «Registro del corte»). Plan y decisiones: `docs/plans/2026-11-18-migracion-beta-vps.md`.

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

**Quitados en el corte (2026-11-19):** hoy el panel solo tiene `DEPLOYMENT_ENV`, `RELEASE_ENVIRONMENT` y `NODE_OPTIONS`. Se vuelven a poner solo si el VPS tiene que convivir otra vez con un hosting que corra jobs. Mientras el hosting viejo seguía activo, el VPS corría con estos valores en **Entorno** para no duplicar tareas:

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

### Registro del corte (2026-11-19)

El dueño pidió adelantar el corte: el TTL bajó a 300 s a las 15:42 y el registro cambió a las 15:52 (-03), sin esperar las 4 h. Para que eso fuera seguro:

- **Jobs del hosting compartido apagados en su `.env`** antes de cambiar el DNS: `~/weotzi-deploy/shared/main.env` tiene ahora `QUOTATION_EXPIRY_JOB=off`, `GCAL_SYNC_JOB=off`, `IMAGE_FP_JOB=off`, `TURNOS_HOLD_JOB=off`, `SESSION_REMINDERS_JOB=off` y `MOST_WANTED_INTERVAL_HOURS=0` (respaldo intacto en `main.env.bak-20261119-corte`). Así, si el poller de hPanel vuelve a publicar, la app vieja arranca igual sin jobs.
- La app vieja siguió viva hasta las 20:00 (-03) para los resolvers que todavía tenían la IP vieja con el TTL de 4 h (vencía 19:47); a esa hora se detuvo con `pm2 stop`.
- Squarespace pide verificar de nuevo la cuenta de Google antes de editar DNS (lo hace el dueño).
- **Límites aplicados:** `agents-ai_chromium` 1536 MB / 1 núcleo. Pendientes, en un horario sin uso (cada cambio reinicia el servicio): `chatbot-we-otzi` (n8n, evolution-api, postgres, alicia-calls).
- **Ojo con `agents-ai_hermes-agent`:** publica un puerto en modo host y su orden de actualización es `start-first`, así que cualquier cambio de spec queda en `Pending` (la tarea nueva no consigue el puerto). Se revirtió con `docker service rollback`; para limitarlo hay que pasar antes a `stop-first` (corta el servicio unos segundos).
- Easypanel guarda los recursos pero no los aplica hasta un «Implementar»; para no reconstruir servicios ajenos se aplicaron con `docker service update --limit-memory … --limit-cpu …`, con el mismo valor que quedó en el panel.

- **Cron del poller quitado de hPanel** (2026-11-19, sitio weotzi.com → Avanzado → Cron Jobs; hPanel no permite pausarlo, solo eliminarlo). Para restaurarlo, crear una tarea de tipo «Custom» con frecuencia `* * * * *` y el comando `/usr/bin/php /home/u795331143/domains/weotzi.com/public_html/beta/auto_monitor.php`.

## Lo demás que se mudó al VPS (2026-11-19)

El dueño pidió que no quede nada de We Ötzi en el hosting compartido. `bangtanstylefbar.com` y el WordPress de prueba `yellowgreen-woodcock-947419.hostingersite.com` quedan allá por decisión suya.

### weotzi.com (WordPress corporativo)

- Easypanel, proyecto `we-otzi-app` (la licencia gratuita admite 3 proyectos): servicio `web` (`wordpress:php8.2-apache`) y `web-db` (`mariadb:11.4`).
- Archivos en `/srv/weotzi-web/html` (copia exacta del docroot, 24.538 archivos; `beta/` solo con el `.htaccess` que redirige `weotzi.com/beta/*` → `beta.weotzi.com`). Datos de MariaDB en `/srv/weotzi-web/db`.
- Claves de la base generadas en el VPS: `/etc/weotzi/web/db_password` y `db_root_password`, montadas en `/run/secrets/weotzi-web`. `wp-config.php` lee la clave del archivo (`MARIADB_*_FILE` en la base). Nadie las tipea en el panel. El `wp-config.php` original quedó en `/srv/weotzi-web/wp-config.hostinger.php`.
- `wp-config.php` respeta `X-Forwarded-Proto` (HTTPS termina en Traefik). PHP: `/srv/weotzi-web/php.ini` (512 MB de memoria y de subida).
- Correo de WordPress: mu-plugin `wp-content/mu-plugins/weotzi-smtp.php`, envía por `mail.weotzi.chat:465` como `notificaciones@weotzi.chat` (el remitente original pasa a Reply-To). Clave en `/etc/weotzi/web/smtp_password` (root:www-data 0440).
- DNS (Squarespace): `@` y `www` → `69.62.98.207`, TTL 300 s. Let's Encrypt para los dos.
- `staging.weotzi.com` se borró el 2026-11-19 (apuntaba al compartido y no servía nada).

### Correo de weotzi.chat (BillionMail)

- BillionMail (`/opt/billionmail`, fuera de Easypanel) atiende `weotzi.chat`. Postfix se presenta como `mail.weotzi.chat` (`conf/postfix/main.cf`, respaldo `main.cf.bak-20261119`; es un montaje de archivo: editar en el mismo inodo y reiniciar el contenedor).
- Buzón `notificaciones@weotzi.chat`, creado con el mismo formato que `bm.sh add-email`; la clave está solo en `/etc/weotzi/mail/notificaciones.pw` (root 0400).
- DKIM: `default._domainkey.weotzi.chat` (rspamd, `bm.sh add-domain`). SPF: `v=spf1 ip4:69.62.98.207 ~all` (sin Hostinger desde el 2026-11-19). MX: `mail.weotzi.chat`. La zona DNS de `weotzi.chat` está en hPanel → Dominios (el dominio sigue registrado en Hostinger; no depende del plan de hosting).
- Certificado: Traefik emite el de `mail.weotzi.chat` (ruta en `/etc/easypanel/traefik/config/billionmail.yaml`, respaldo en `/root/billionmail.yaml.bak-20261119`) y `/usr/local/sbin/weotzi-mail-cert-sync` (timer diario `weotzi-mail-cert-sync.timer`) lo copia a `/opt/billionmail/ssl` y recarga Postfix/Dovecot.
- n8n: la credencial «We Otzi notificaciones Hostinger» (relé de beta; conserva el nombre) apunta a `mail.weotzi.chat:465` desde el 2026-11-19, cambiada con `n8n import:credentials` sin tipear la clave. Respaldo cifrado de la anterior: `/home/node/.n8n/backups/cred-uEboReZj3XMBLc1P-20261119.json` (volumen de n8n). «SMTP account» usa Gmail de `weotzi.com` y no depende de Hostinger.
- PTR de la IPv4 del VPS: `mail.weotzi.chat` (hPanel → VPS → Settings → IP address).
- Prueba real del 2026-11-19: beta → relé de n8n → `mail.weotzi.chat` → Gmail, `status=sent 250`, `DKIM_SIGNED`, puntaje rspamd 0,01.

### Respaldos

- `/usr/local/sbin/weotzi-backup` con el timer `weotzi-backup.timer` (todos los días a las 06:40 UTC) guarda en `/srv/backups/<fecha>/` (root 0700):
  - el volcado de la base de WordPress;
  - los archivos de WordPress, los domingos;
  - la base y los datos de BillionMail (buzones, configuración, DKIM, certificados);
  - la exportación de flujos y credenciales de n8n, más `n8n-config.json`, la clave de cifrado sin la cual no se restauran las credenciales;
  - `/etc/weotzi`;
  - un archivo `SHA256SUMS`.
- Retención: 7 días; los archivos de WordPress, 4 copias.
- **Está en el mismo disco del VPS.** Contra la pérdida del VPS hacen falta además una copia fuera (la PC del dueño o la nube) y los respaldos automáticos de Hostinger del VPS (hPanel → VPS → Snapshot & backups).

### Seguridad heredada del sitio viejo (corregida el 2026-11-19)

- `tools/api/upload.php` aceptaba subidas sin autenticación y Apache ejecutaba lo subido. Se retiró del docroot en el VPS y en el compartido. `tools/uploads` solo tenía 3 imágenes de febrero, sin rastros de abuso. Si el carrusel de `/tools` hace falta, hay que reescribir la subida con una lista de extensiones permitidas y autenticación.
- `wp-config.php.security-bak-20260718` se podía descargar y contiene la `DUPLICATOR_AUTH_KEY` vigente. Se retiró, igual que `local-xdebuginfo.php`. El 2026-11-20 se rotó esa clave y `wp-content/backups-dup-pro` (437 MB) salió del docroot (ver «Endurecimiento»).
- Lo retirado quedó en `/srv/archivo-hostinger/20261119/retirados-del-docroot/` (VPS) y en `~/weotzi-deploy/retirados-docroot-20261119/` (compartido).
- Los puertos 3000, 8088 y 8443 se cerraron el 2026-11-20 (ver «Endurecimiento»). El apex `weotzi.chat` es el dominio del panel de Easypanel (HTTPS) y se queda así. Falta que el dueño active 2FA en Easypanel.

### Supabase Auth

Supabase Auth envía las confirmaciones de cuenta y la recuperación de contraseña. Su SMTP propio usaba `smtp.hostinger.com`. Desde el 2026-11-19 usa `mail.weotzi.chat:465` con `notificaciones@weotzi.chat`; el dueño escribió la clave en Supabase → Authentication → Emails → SMTP Settings. Prueba: recuperación de contraseña real → Gmail `250`, `DKIM_SIGNED`, rspamd 1,7.

Ajustes de Postfix para esto (`conf/postfix/main.cf`; respaldos `main.cf.bak-20261119` y `main.cf.bak-20261119b`): Supabase no manda `Message-ID`, así que Postfix lo agrega en los envíos autenticados (`local_header_rewrite_clients = permit_inet_interfaces, permit_sasl_authenticated` y `always_add_missing_headers = yes`). Además, `inet_protocols = ipv4`, porque el contenedor no tiene salida IPv6.

### Previews

`preview.weotzi.chat` se dio de baja: `valentina-delivery.cjs` confirma la entrega con CI y la rama remota (`PREVIEW_ENABLED = false`), y `AGENTS.md` y las guías de Valentina remiten a la preview local (`npm run dev:safe`).

### Archivo del hosting compartido

`/srv/archivo-hostinger/20261119/` (root 0700): respaldos de WordPress (`backups-wp`), `weotzi-deploy` sin `releases` ni `repository.git` (incluye `shared/main.env`), el docroot de beta (con sus `.env` y credenciales viejas), el de previews, el `wp-config`/`.htaccess` originales y el volcado de la base de WordPress. Sigue haciendo falta una copia **fuera** del VPS de los secretos de beta.

**Lo que todavía vive en Hostinger (auditoría del 2026-11-19, antes de mudar weotzi.com y el correo):**

- **Redirección `weotzi.com/beta/*` → `beta.weotzi.com`:** está en `public_html/beta/.htaccess` y la usan enlaces y correos viejos. Al limpiar, conservar un `.htaccess` mínimo con `RewriteRule ^(.*)$ https://beta.weotzi.com/$1 [R=301,L]`, o mover la regla al `.htaccess` del apex.
- **Sitio corporativo `weotzi.com`** (WordPress, apex y `www`): beta enlaza ahí sus FAQ y la política de privacidad. La limpieza toca solo lo de beta: `~/weotzi-deploy`, `public_html/beta` (salvo la redirección) y pm2.
- **Correo transaccional:** el relé de n8n envía por SMTP de Hostinger Mail (`weotzi.chat`). No depende de los archivos del compartido, pero sí del plan: antes de cancelar nada, confirmar que el buzón no está atado al plan de hosting.
- **Secretos:** hoy existen solo en `/etc/weotzi/beta.env` y en las copias del compartido (`shared/main.env`, `public_html/beta/.env`). **Antes de limpiar**, guardar una copia fuera de línea completa en el gestor de secretos, sobre todo `DATA_ENC_KEY`, `GCAL_TOKEN_ENC_KEY` y `BAN_HMAC_KEY`. Sin ellas, los datos cifrados no se pueden recuperar. En la limpieza, borrar también las credenciales que quedaron en `public_html/beta` (`.env`, `.server-credentials*`, `.billionmail-*`, `.deploy_backups/`, `.git`). Hoy no se sirven: responden 403, 404 o redirigen.
- **Previews `preview.weotzi.chat`:** caídas desde el 6 de noviembre, antes de esta migración. Viven solo en el compartido y dependían del cron que se quitó. Decidir si se mueven al VPS o se dan de baja, y actualizar `AGENTS.md` y `scripts/release/valentina-delivery.cjs`, antes de borrar `~/domains/preview.weotzi.chat` o `~/weotzi-deploy/control`.
- **Resolver del VPS** (`45.143.83.10`): guardó la IP vieja de `beta` un rato después del corte, así que n8n siguió llamando al compartido hasta que venció esa caché. El apagado de pm2 verifica antes que el VPS ya resuelva la IP nueva.

Pendientes del corte: ver «Endurecimiento y cierre de pendientes (2026-11-20)».

## Endurecimiento y cierre de pendientes (2026-11-20)

- **SSH solo con llave:** `/etc/ssh/sshd_config.d/00-weotzi-hardening.conf` (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`). Va con `00` porque sshd usa el primer valor y `50-cloud-init.conf` traía `PasswordAuthentication yes`. Entra la llave `~/.ssh/weotzi_vps`; la del deploy de mi-dinero sigue restringida a su comando.
- **Clave de root rotada:** la que se pegó en el chat ya no sirve. La nueva está solo en `.server-credentials` del repo principal (`VPS_ROOT_PASS`, fuera de git). Por SSH no sirve; es para la consola de hPanel.
- **Puertos de administración cerrados hacia Internet:** `/usr/local/sbin/weotzi-firewall` + `weotzi-firewall.service` (corre después de Docker) agregan reglas `DROP` en `DOCKER-USER`, IPv4 e IPv6, para lo que entra por `eth0` a 3000, 8088 y 8443. Desde el VPS y por túnel SSH siguen accesibles. Para abrirlos: `systemctl stop weotzi-firewall`.
  - Panel de Easypanel: `https://weotzi.chat` (ya era su dominio). Panel de BillionMail: `https://mail.weotzi.chat`.
  - Siguen abiertos: 22, 25, 80, 443, 110, 143, 465, 587, 993 y 995. También 8642/9119 (`agents-ai_hermes-agent`, no son de We Ötzi) y 2377/7946 de Swarm, que escucha dockerd fuera de `DOCKER-USER`: para esos hace falta el firewall de hPanel.
- **Traefik:** se quitaron las rutas `bm.weotzi.com` de `billionmail.yaml` (no tenían DNS y solo generaban errores de ACME); respaldo en `/root/billionmail.yaml.bak-20261120`.
- **WordPress:** `DUPLICATOR_AUTH_KEY` rotada (respaldo del `wp-config.php` anterior en `/root/wp-config.php.bak-20261120`, root 0600) y `wp-content/backups-dup-pro` movido a `/srv/archivo-hostinger/20261119/retirados-del-docroot/`. Comentarios: el compartido tiene 30 (el último del 17 de noviembre) y el VPS 31; no se perdió ninguno.
- **Buzón viejo:** los 19 correos de `notificaciones@weotzi.chat` en Hostinger Mail se copiaron al buzón de BillionMail (carpetas, marcas y fechas; sin duplicar por `Message-ID`). La clave vieja se leyó del respaldo cifrado de n8n y no se mostró.
- **DNS de `weotzi.chat` (hPanel):** se borraron `autodiscover`, `autoconfig` y `hostingermail-{a,b,c}._domainkey` (todos de Hostinger Mail). `mail` y el MX pasaron a TTL 3600. `preview.weotzi.chat` no está en la zona: lo publica el plan de hosting y desaparece al darlo de baja.
- **Límites de `chatbot-we-otzi`:** `/usr/local/sbin/weotzi-limits-chatbot`, programado con un timer transitorio para el 2026-11-21 a las 07:00 UTC (04:00 -03), porque cada cambio reinicia el servicio. Valores: n8n 2,5 GB / 1,5 núcleos; evolution-api 768 MB; postgres 1 GB; alicia-calls 512 MB; evolution-api-db 512 MB; redis 256 MB. Si un servicio no queda 1/1, se revierte solo. Log: `journalctl -u weotzi-limits-chatbot`. Hay que cargar los mismos valores en Easypanel → Recursos; si no, un «Implementar» los borra.
- **Copia fuera del VPS:** `/srv/backups` y `/srv/archivo-hostinger` copiados a la PC del dueño (`WeOtzi-respaldos-VPS` en su carpeta de usuario, 1,3 GB, `SHA256SUMS` verificado). Es una copia puntual: conviene repetirla o activar los respaldos de Hostinger del VPS.
- **Renovación:** el KVM 2 (`srv861237`) se renueva solo el 2026-11-28 (USD 24,49). El plan Premium Web Hosting de `weotzi.com` también se renueva solo el 2027-01-05: apagar esa renovación cuando se dé de baja el compartido.
- **Pendiente del dueño:** iniciar sesión en `https://weotzi.chat`, activar 2FA, borrar `we-otzi-app-beta.jubcpl.easypanel.host` y cargar los Recursos de `chatbot-we-otzi`. Subir el TTL de `weotzi.com` en Squarespace (pide verificar con Google).
- **n8n (fallas previas a la migración, sin tocar):**
  - «We Otzi Digest & Reports» pide la columna `artists_db.artist_name`, que ya no existe. Corregirla haría que empiecen a salir resúmenes diarios a todos los artistas, así que es una decisión de producto.
  - «Store · Mantenimiento horario» no tiene credencial.
  - «Daily Currency Rates» da 401 (token).
  - «Email Whatsapp Notifications» falla con correos sin adjunto.
  - La base SQLite de n8n pesa 4 GB.

## Volver al hosting compartido (rollback de la migración)

1. Redesplegar el VPS **con los interruptores de jobs apagados** (que no corran en dos lados).
2. En el compartido, devolver los jobs: `cp -p ~/weotzi-deploy/shared/main.env.bak-20261119-corte ~/weotzi-deploy/shared/main.env` (o quitar las seis líneas de interruptores).
3. Revertir `A beta` → `92.112.189.44`.
4. En el compartido: `PM2_HOME=~/weotzi-deploy/pm2 ~/node_modules/pm2/bin/pm2 start ~/weotzi-deploy/processes/main.json --only weotzi-beta` y reactivar el cron de hPanel.
5. Detener el servicio del VPS cuando pase el TTL.

El hosting compartido se conserva intacto al menos 4 semanas después del corte.
