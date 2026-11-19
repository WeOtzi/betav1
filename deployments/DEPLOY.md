# Guía de Despliegue — We Ötzi Beta

> Documento para agentes y desarrolladores. Cubre despliegue completo y parcial al servidor de producción `beta.weotzi.com`.

> **Migración en curso (2026-11-18):** beta se está pasando a un VPS con Easypanel. Runbook nuevo en [`deployments/vps/README.md`](vps/README.md) y plan en [`docs/plans/2026-11-18-migracion-beta-vps.md`](../docs/plans/2026-11-18-migracion-beta-vps.md). Hasta el corte de DNS, beta se sigue sirviendo desde el hosting compartido según esta guía y `deployments/hostinger/RELEASE-RUNBOOK.md`.

---

## Estándar de datos (obligatorio desde 2026-06-21)

Todo acceso a datos pasa por la **capa PostgREST unificada** (`lib/postgrest.js` +
repos en `lib/repos/` en el servidor; `window.WeotziData` en el frontend). **No se
despliega CRUD ad-hoc nuevo** (`fetch('/rest/v1/...')` inline ni `_supabase.from(...)`
disperso). Cómo construir sobre la capa: [docs/GUIA_CAPA_DATOS.md](../docs/GUIA_CAPA_DATOS.md).

## Checklist pre-despliegue

1. `node --test "tests/*.test.js"` en verde.
2. `node --check` en los `.js` tocados (server + módulos frontend).
3. Cero accesos directos a los dominios ya migrados fuera de los repos
   (`grep -rnE "\.from\('quotations_db'" public/shared/js --include=*.js | grep -v data/`).
4. Si cambió el esquema: la migración SQL está aplicada en Supabase (`flbgmlvfiejfttlawnfu`).
   **Excepción, ronda 2:** las migraciones `20261116*` van DESPUÉS del código, no antes
   (ver [Ronda 2 · orden de despliegue y migraciones](#ronda-2--orden-de-despliegue-y-migraciones)).
5. Decidir Opción A (solo `public/`) vs Opción B (server.js/lib/package.json → reinicia PM2).

---

## Datos de Conexión

| Parámetro       | Valor                                                              |
|-----------------|--------------------------------------------------------------------|
| Host            | `92.112.189.44`                                                    |
| Puerto SSH      | `65002`                                                            |
| Usuario         | `u795331143`                                                       |
| Contraseña      | Leer de `.server-credentials` en la raíz del proyecto             |
| Directorio app  | `/home/u795331143/domains/weotzi.com/public_html/beta`             |
| Proceso PM2     | `weotzi-beta`                                                      |
| Puerto Node.js  | `4545`                                                             |
| URL producción  | `https://beta.weotzi.com`                                          |

La contraseña siempre se lee del archivo `.server-credentials`:
```
SSH_PASS=<contraseña>
```
Si el archivo no existe, configurar `WEOTZI_SSH_PASSWORD` o `SSH_PASS` en el entorno local. No debe existir fallback de contraseña en claro dentro del repositorio.

---

## Requisitos del entorno local

```bash
pip install paramiko scp
```

Python debe tener `paramiko` y `scp` instalados. Verificar con:
```bash
python3 -c "import paramiko; from scp import SCPClient; print('OK')"
```

---

## Plantilla de conexión SSH (paramiko)

```python
import paramiko
from scp import SCPClient

# Leer credenciales
with open('.server-credentials') as f:
    creds = dict(line.strip().split('=', 1) for line in f if '=' in line)
PASSWORD = creds.get('SSH_PASS')
if not PASSWORD:
    raise RuntimeError('Missing SSH_PASS in .server-credentials')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.112.189.44', port=65002, username='u795331143', password=PASSWORD)

def run(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

# Siempre al terminar:
ssh.close()
```

Prefijo obligatorio para comandos Node/PM2:
```bash
export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2
```

---

## Opción A — Despliegue parcial (archivos estáticos)

Usar cuando solo cambian archivos en `public/` (JS, CSS, HTML).
**No requiere reiniciar PM2.**

```python
REMOTE_BASE = '/home/u795331143/domains/weotzi.com/public_html/beta'
LOCAL_BASE  = '/mnt/c/dev/weotzi-unified'

# Subir un archivo específico
with SCPClient(ssh.get_transport()) as scp:
    scp.put(
        f'{LOCAL_BASE}/public/shared/js/script.js',
        remote_path=f'{REMOTE_BASE}/public/shared/js/script.js'
    )

# Subir un directorio completo
with SCPClient(ssh.get_transport()) as scp:
    scp.put(f'{LOCAL_BASE}/public/shared/js/', remote_path=f'{REMOTE_BASE}/public/shared/js/', recursive=True)
    scp.put(f'{LOCAL_BASE}/public/shared/css/', remote_path=f'{REMOTE_BASE}/public/shared/css/', recursive=True)
```

Verificar que el archivo llegó:
```python
out, err = run(f'ls -la {REMOTE_BASE}/public/shared/js/script.js')
print(out)
```

---

## Opción B — Despliegue completo

Usar cuando cambian `server.js`, `package.json`, `ecosystem.config.js`, o múltiples directorios.
**Requiere reiniciar PM2.**

El script existente en `scripts/deploy_beta.py` realiza todo el proceso:

```bash
cd "/mnt/c/dev/weotzi-unified"
python3 scripts/deploy_beta.py
```

Lo que hace internamente:
1. Crea ZIP del proyecto (excluye `node_modules/`, `.git/`, `scripts/`, `*.py`, `*.zip`)
2. Sube el ZIP por SCP
3. Descomprime en el servidor
4. Ejecuta `npm install --production`
5. Elimina el proceso PM2 anterior y lo reinicia con `ecosystem.config.js`

---

## Gestión de PM2

```python
ENV = 'export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2'
DIR = '/home/u795331143/domains/weotzi.com/public_html/beta'
PM2 = './node_modules/.bin/pm2'

# Ver estado
run(f'{ENV} && cd {DIR} && {PM2} list')

# Reiniciar
run(f'{ENV} && cd {DIR} && {PM2} restart weotzi-beta')

# Ver logs (últimas 100 líneas)
run(f'{ENV} && cd {DIR} && {PM2} logs weotzi-beta --lines 100 --nostream')

# Iniciar desde cero
run(f'{ENV} && cd {DIR} && {PM2} start ecosystem.config.js --update-env')
```

---

## Diagnóstico rápido del servidor

```python
ENV = 'export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2'
DIR = '/home/u795331143/domains/weotzi.com/public_html/beta'
PM2 = './node_modules/.bin/pm2'

checks = [
    ('PM2 status',    f'{ENV} && cd {DIR} && {PM2} list'),
    ('Puerto 4545',   'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4545/'),
    ('Logs recientes',f'{ENV} && cd {DIR} && {PM2} logs weotzi-beta --lines 30 --nostream'),
    ('Disco',         'df -h /'),
    ('Memoria',       'free -h'),
]

for label, cmd in checks:
    out, err = run(cmd)
    print(f'--- {label} ---')
    print(out or err)
```

---

## Variables de entorno · Google Calendar (artistas)

La integración con Google Calendar (Cuenta → Disponibilidad y el calendario) se
configura **solo** con variables de entorno en el `.env` del servidor (nunca en
el repo ni en `app_settings`). Sin ellas, `/api/google-calendar/*` responde 503
"Google Calendar no está configurado" y la UI lo muestra sin romperse.

| Variable | Valor | Origen |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | `….apps.googleusercontent.com` | Google Cloud Console → Credenciales → cliente OAuth "Aplicación web" → *ID de cliente* |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `GOCSPX-…` | Mismo cliente → *Secreto del cliente* |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://beta.weotzi.com/api/google-calendar/callback` (default) | Tiene que coincidir **exacto** con el URI de redireccionamiento autorizado del cliente |
| `GCAL_TOKEN_ENC_KEY` | 32 bytes en base64 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (cifra los refresh tokens con AES-256-GCM; si cambia, todos reconectan) |
| `GCAL_SYNC_JOB` | vacío / `off` | `off` apaga el job de sincronización cada 15 min |
| `GCAL_DIRTY_POLL_MS` | vacío / ms / `0` | Cada cuánto se publican los cambios marcados por la base (`dirty_at`, migración 20261115150000). Vacío = 30000; `0` lo apaga. Ver `docs/GCAL_SINCRONIZACION.md` |

Requiere la migración `supabase/migrations/20261113102000_google_calendar_sync.sql`
(después de `20261112190000`). Cambiar estas variables exige **reiniciar PM2**
con `--update-env`.

Alta en Google Cloud Console (una vez):
1. Proyecto propio (p. ej. "We Otzi Calendar") → *APIs y servicios → Biblioteca* → habilitar **Google Calendar API**.
2. *Pantalla de consentimiento de OAuth*: tipo **Externo**; nombre "We Ötzi"; email de asistencia; logo opcional; página principal `https://weotzi.com`, política de privacidad y términos en weotzi.com; **dominios autorizados** `weotzi.com`; scopes `openid`, `.../auth/userinfo.email` y `https://www.googleapis.com/auth/calendar.events` (sensible). Mientras esté en "Prueba", agregar los emails de los artistas de prueba (máx. 100); para abrirlo a todos, "Publicar" y pedir la verificación de Google por el scope sensible.
3. *Credenciales → Crear credenciales → ID de cliente de OAuth* → tipo **Aplicación web** → *URI de redireccionamiento autorizados*: `https://beta.weotzi.com/api/google-calendar/callback` (sin barra final). Orígenes de JavaScript: no hacen falta.
4. Copiar ID y secreto a `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, generar `GCAL_TOKEN_ENC_KEY` y reiniciar PM2.

---

## Variables de entorno · Cifrado de datos sensibles

El servidor cifra con AES-256-GCM (`lib/field-crypto.js`) los números de cuenta
de los destinos de retiro (`artist_payout_destinations`) y el `apify_token` de
`app_settings`. La clave vive **solo** en el `.env` del servidor (nunca en el
repo, en `app_settings` ni en el navegador). Sin ella, el alta/edición de
destinos y "ver número completo" responden 503 con un mensaje claro; el resto
del servidor sigue funcionando.

| Variable | Valor | Uso |
|---|---|---|
| `DATA_ENC_KEY` | 32 bytes en base64 | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` · clave primaria (cifra y descifra) |
| `DATA_ENC_KEY_ID` | `k1` (default) | id de la clave primaria; va dentro de cada valor cifrado (`wo1:<id>:…`) |
| `DATA_ENC_PREVIOUS_KEYS` | `k1=<base64>,k0=<base64>` | claves anteriores, solo para descifrar durante una rotación |

**Guardá una copia de `DATA_ENC_KEY` fuera del servidor** (gestor de secretos):
si se pierde, los números de cuenta cifrados no se pueden recuperar y los
artistas tienen que volver a cargarlos.

Primera puesta en marcha (en este orden):
1. Generar `DATA_ENC_KEY`, agregarla al `.env` del servidor y reiniciar PM2 con `--update-env`.
2. Aplicar `supabase/migrations/20261113104000_field_encryption.sql` (validada antes con begin…rollback).
3. Desplegar el código.
4. En el servidor: `node scripts/encrypt-existing-data.cjs` (dry-run, solo conteos) → `--apply` (cifra y verifica fila por fila) → `--verify` (tiene que decir "0 discrepancias").
5. Solo con el OK del dueño y un backup de la tabla: mover `supabase/pending/20261113104500_drop_plaintext_payout_identifier.sql` a `supabase/migrations/` y aplicarla (borra el dato en claro).

Rotación de la clave:
1. Generar una clave nueva. En el `.env`: `DATA_ENC_KEY=<nueva>`, `DATA_ENC_KEY_ID=k2`, `DATA_ENC_PREVIOUS_KEYS=k1=<vieja>`. Reiniciar PM2 con `--update-env`.
2. `node scripts/encrypt-existing-data.cjs --apply` (re-cifra con `k2` todo lo que esté en `k1`; no toca el estado de verificación) y `--verify`.
3. Cuando `--verify` da 0 discrepancias, quitar la clave vieja de `DATA_ENC_PREVIOUS_KEYS` y reiniciar.

Cada vez que soporte o el artista ven un número completo queda registrado en
`sensitive_data_access_log` (quién, cuándo, para qué; nunca el dato).

---

## Variables de entorno · Emails

| Variable | Uso |
|---|---|
| `PUBLIC_APP_URL` | **Obligatoria en beta**: `https://beta.weotzi.com`. Base de TODOS los links de los correos, del perfil público y de Google Calendar. Sin ella el servidor usa `https://beta.weotzi.com` y avisa al arrancar (nunca el header `Host`). |
| `SUPPORT_EMAIL` | Copia de las disputas y `reply_to` de los correos del relé. |
| `N8N_EMAIL_RELAY_URL` | Webhook genérico de n8n "We Ötzi · Enviar email" (canal `smtp_relay`, contrato en `docs/N8N_EMAIL_WEBHOOKS.md`). También se puede cargar en `app_settings.email_relay_url`. |
| `N8N_EMAIL_RELAY_TOKEN` | Header `X-Weotzi-Webhook-Token` del relé. Vacío → `N8N_WEBHOOK_SECRET` / `app_settings.n8n_webhook_secret`. |
| `EMAIL_DEFAULT_CHANNEL` | Canal por defecto (`n8n` si falta). `email_routing['*'].channel` lo pisa; cada evento puede tener el suyo. |
| `QUOTATION_ADMIN_EMAIL` | Opcional: copia al admin de cada solicitud nueva cuando `client_quotation_submitted` sale por el relé. |
| `CHAT_EMAIL_WINDOW_MS` / `CHAT_EMAIL_DELAY_MS` | Ventana (15 min) y espera (2 min) de los avisos de chat e inbox. |
| `EMAIL_DISPATCH_RATE_MAX` | Avisos por minuto y usuario en `POST /api/email/:eventId` (30). |
| `SESSION_REMINDERS_JOB` / `SESSION_REMINDERS_INTERVAL_MS` | Recordatorio 24 h de sesiones (on cada 30 min; `off` lo apaga). Cron alternativo: `POST /api/sessions/reminders/dispatch` con `X-Cron-Token`. |

Previews de todos los correos: `node scripts/email-preview.js` → `output/email-previews/index.html`.

---

## Variables de entorno · Avisos push (Web Push)

Los avisos push salen del propio servidor (`lib/web-push.js`: VAPID RFC 8292 +
cifrado `aes128gcm` RFC 8291, sin dependencias ni servicios de terceros). Sin
las claves **el push queda apagado en silencio**: `GET /api/push/config`
responde `enabled:false`, la tarjeta "Avisos en este dispositivo" lo explica y
los avisos dentro de la app (toast + sonido por Realtime) siguen funcionando.

| Variable | Valor | Cómo se obtiene |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Punto P-256 (65 bytes) en base64url | `node scripts/generate-vapid-keys.js mailto:<contacto>` imprime las tres líneas |
| `VAPID_PRIVATE_KEY` | Escalar P-256 (32 bytes) en base64url | Ídem. **Secreta**: solo en el `.env` del servidor y en el gestor de secretos |
| `VAPID_SUBJECT` | `mailto:…` o `https://…` | Contacto que ven los servicios push. Vacío → `mailto:SUPPORT_EMAIL` o `PUBLIC_APP_URL` |
| `PUSH_ALLOWED_HOSTS` | Opcional, hosts separados por coma | Servicios push extra. Por defecto: FCM (Chrome/Edge/Opera), Mozilla, WNS y Apple |

Alta (una sola vez):

1. Aplicar la migración `supabase/migrations/20261116170000_push_notifications.sql` (tablas `push_subscriptions` y `user_notifications`, esta última en la publicación `supabase_realtime`).
2. `node scripts/generate-vapid-keys.js mailto:<contacto>` en una máquina de confianza y pegar las tres líneas en el `.env` del servidor.
3. Reiniciar PM2 con `--update-env`. Si las claves quedaron mal cargadas, el arranque avisa `[push] VAPID mal configurado (<motivo>)` y el push queda apagado (nunca tumba el servidor).
4. Probar: Centro de cuenta → Notificaciones → **Activar avisos** → **Probar aviso**.

Notas:

- El service worker es `public/wo-sw.js` (raíz pública, alcance `/`); solo se registra cuando el usuario toca "Activar avisos". Necesita HTTPS (o `localhost`).
- Cambiar las claves no rompe nada: cada navegador se vuelve a suscribir solo la próxima vez que abre la app. Las suscripciones vencidas (404/410 del servicio push) se borran solas.
- iPhone / iPad: Safari solo entrega push a la web instalada en la pantalla de inicio. En una pestaña común se ven los avisos dentro de la app.
- Qué se avisa: los mismos eventos que salen por correo a un usuario registrado (cotizaciones, mensajes, calendario, estudios, verificación), con el asunto y el preheader del correo. Nunca códigos, contraseñas ni datos de salud. Cada usuario lo regula con la columna "Push" de su matriz de notificaciones.

---

## Variables de entorno · IA de imágenes (OpenAI)

La generación de imágenes con IA (referencia del cotizador, avatar del artista,
"Inspirarme con AI" del Job Board e íconos de zonas del backoffice) usa **OpenAI
con GPT Image 2.6** a través de `lib/ai-image.js`. Se configura **solo** con
variables de entorno en el `.env` del servidor: la clave nunca va al repo, al
navegador ni al backoffice. Sin clave, `POST /api/ai/generate-image` y
`POST /api/quotations/ai-reference` responden 503 y el cotizador no muestra
"Generar referencia con IA" (`aiImages.enabled = false` en la config pública).

| Variable | Valor | Uso |
|---|---|---|
| `OPENAI_API_KEY` | `sk-…` | Clave de la API de OpenAI. **Secreta.** Es la misma que usa el bot del chat de soporte: cargarla lo enciende salvo `SUPPORT_CHAT_ENABLED=false` (ver el paso 4 del alta) |
| `AI_IMAGE_PROVIDER` | vacío / `openai` / `gemini` / `off` | Vacío: OpenAI. `gemini` usa el proveedor heredado (necesita `GEMINI_API_KEY`; esa clave sola **no** lo activa). `off` apaga las imágenes con IA aunque haya claves (el chat de soporte sigue) |
| `AI_IMAGE_MODEL` | `gpt-image-2.6-flare` (default) / `gpt-image-2.6-sunburst` | Modelo general. `flare` es el rápido de uso cotidiano; `sunburst`, el de trabajo detallado. Un valor desconocido cae al default |
| `AI_REFERENCE_MODEL` | mismos valores | Modelo de la referencia con IA del cotizador. Vacío o desconocido (p. ej. un ID viejo de Gemini): usa `AI_IMAGE_MODEL` |
| `AI_IMAGE_QUALITY` | `low` / `medium` (default) / `high` | Calidad pedida a OpenAI. Más calidad = más costo y más espera |
| `AI_IMAGE_TIMEOUT_MS` | ms; default `120000`; máximo `280000` | Espera máxima al proveedor. Vencida, el endpoint responde 504. Tiene que ser **menor** que la espera del proxy PHP para estas rutas (150 s con el proxy del repo; ver el paso 3 del alta) |
| `AI_REFERENCE_DAILY_CAP` | default `300` | Tope diario de imágenes del cotizador (por proceso) |
| `AI_IMAGE_DAILY_CAP` | default `500` | Tope diario del endpoint genérico (`GEMINI_DAILY_CAP` sigue valiendo como alias) |
| `GEMINI_API_KEY` | `AIza…` | Solo para el proveedor heredado (`AI_IMAGE_PROVIDER=gemini`) |

Alta (una sola vez):

1. Crear la clave en la consola de OpenAI (conviene un proyecto propio con límite de gasto mensual) y cargar `OPENAI_API_KEY` en el `.env` del servidor. Si la clave es **restringida**, necesita permiso de **imágenes** (generar) y de **lectura de modelos** (lo usa el chequeo de salud): sin el segundo, el chequeo informa `HTTP 401` aunque las imágenes se generen bien.
2. **Verificar la organización en OpenAI** si la consola lo pide: los modelos GPT Image pueden exigirlo. Sin esa verificación la API responde 403 y la plataforma muestra "No pudimos generar la imagen" (`502 ai_error`); el motivo queda en el log: `[ai-image] generación: provider HTTP 403 …`.
3. **Espera del proxy — obligatorio antes de cargar la clave.** Una imagen puede tardar hasta dos minutos y el proxy PHP público cortaba cada pedido a los 60 s: sin este paso, toda imagen que tarde más de 60 s se genera y **se paga**, pero el navegador recibe un error y la persona reintenta (y vuelve a pagar). Elegir una:
   - **Estado en beta (16 nov 2026): hecho con la opción (a).** El proxy instalado (`~/domains/weotzi.com/public_html/beta/proxy.php`) ya espera 150 s en las tres rutas de imágenes y `AI_IMAGE_TIMEOUT_MS` quedó en `120000`. Respaldo del anterior en `~/weotzi-deploy/backups/`. Probado con una imagen real de 51 s; no se pudo forzar una de más de 60 s.
   - **(a) Recomendada: actualizar el proxy instalado.** `deployments/hostinger/proxy.php` espera 150 s solo en las tres rutas de imágenes (`/api/ai/generate-image`, su alias `/api/gemini/generate-image` y `/api/quotations/ai-reference`) y sigue en 60 s para el resto; si igual se vence, responde un `504 ai_timeout` en JSON. El proxy de beta **se copia a mano** y el instalado conecta por socket Unix, así que no hay que pisarlo con este archivo: trasladarle el bloque `$isAiImage` / `$timeoutSeconds` / `set_time_limit`, el `CURLOPT_TIMEOUT => $timeoutSeconds` y la respuesta 504, conservando su conexión al socket. Dejar antes una copia del proxy actual.
   - **(b) Si no se puede tocar el proxy:** cargar `AI_IMAGE_TIMEOUT_MS=55000` en el `.env` (el servidor corta antes que el proxy, con un 504 claro) y, si hay muchos cortes, `AI_IMAGE_QUALITY=low`. Las imágenes que tarden más de 55 s no llegan.
4. **Chat de soporte con IA — decidir antes de cargar la clave.** `OPENAI_API_KEY` es también la clave del bot del chat de soporte. Si `SUPPORT_CHAT_ENABLED` no vale `false` (sin la variable, el servidor lo toma como `true`), cargar la clave **enciende el bot**: a OpenAI le llegan los mensajes que la persona escribe en ese chat, su nombre de perfil y la página en la que está. Desde la versión 1.1 (16 nov 2026) la política de privacidad lo declara en la sección 6, fila OpenAI, junto con la generación de imágenes. Revisar el `.env` de producción y elegir una:
   - **(a) El bot todavía no:** dejar `SUPPORT_CHAT_ENABLED=false`. Ojo: apaga todos los endpoints de ese chat, también el pase a un agente humano.
   - **(b) El bot sí (decisión tomada el 16 nov 2026):** la política ya lo declara desde su versión 1.1. Si más adelante cambia lo que recibe OpenAI, hay que actualizar esa fila y subir la versión: `TERMS_VERSION` en `lib/terms-acceptance.js` y en `public/shared/js/studio-register.js`, y la constante de `handle_new_user` con una migración nueva como `20261116240000_terminos_version_privacidad_1_1.sql` (toma la definición viva y cambia solo la constante). Quien ya aceptó conserva su versión; el aviso de un cambio importante va por `public/shared/platform-updates.json` o por correo.
5. Reiniciar PM2 con `--update-env` (es un despliegue de Opción B: cambian `server.js` y `lib/`).
6. Probar: Backoffice → APIs → **IA de imágenes (OpenAI)** → **Probar** (genera una imagen real: consume cuota). Para confirmar el paso 3(a), generar una con `AI_IMAGE_QUALITY=high` y el modelo `gpt-image-2.6-sunburst` que tarde más de 60 s: tiene que llegar. Si se corta cerca de los 60 o los 100 s con un error que no es el 504 propio, hay otro límite por delante (servidor web o CDN del hosting) y corresponde la opción (b). "Probar todas las conexiones" y `GET /api/health/gemini` (clave histórica del servicio) consultan el modelo sin generar nada ni gastar cuota, y devuelven `metadata.provider` y `metadata.model`. Ese `healthy` solo dice que la clave puede leer el modelo: **no reemplaza la prueba real** (una organización sin verificar pasa el chequeo y falla al generar).

Notas:

- **Tiempo de espera y proxy.** Una imagen puede tardar entre 30 y 90 s en calidad media o alta, y OpenAI avisa que un pedido complejo puede llegar a los dos minutos. El proxy PHP público corta el resto de los pedidos a los 60 s (`CURLOPT_TIMEOUT`); para las tres rutas de imágenes el del repo (`deployments/hostinger/proxy.php`) espera 150 s. La regla es que el servidor corte **antes** que el proxy: `AI_IMAGE_TIMEOUT_MS` (120 s por defecto) tiene que quedar al menos 20 s por debajo de la espera del proxy. Si se sube una, subir la otra. Un proxy viejo (60 s para todo) con el servidor en 120 s es el caso que hay que evitar: ver el paso 3 del alta.
- Qué viaja a OpenAI: el prompt (en el cotizador lo arma el servidor con la idea, el estilo, la zona y el color), el modelo, el tamaño y un `safety_identifier` (SHA-256 de la llave del borrador o del id de la cuenta). Para generar imágenes, nunca email, nombre ni IP (el chat de soporte es otro flujo con la misma clave: ver el paso 4 del alta). La política de privacidad (sección 6) nombra a OpenAI como proveedor de imágenes: si se activa el proveedor heredado (Gemini, solo con `AI_IMAGE_PROVIDER=gemini`), hay que actualizarla antes.
- Límites propios: 6 imágenes por borrador y 10 por IP por hora en el cotizador (el tope por borrador es de cortesía: la llave la elige el navegador; el que acota es el de IP); 20 por hora por IP en el endpoint genérico; más los topes diarios de la tabla. Los topes diarios cuentan los pedidos que llegan al proveedor: un pedido inválido (sin texto) o hecho sin clave no descuenta, y lo que el proveedor rechaza sin generar (contenido bloqueado, clave, cuota) se devuelve. Un vencimiento o un error 5xx **sí** descuentan, porque la imagen pudo generarse y cobrarse. En el endpoint genérico solo un superadmin puede pedir un tamaño que no sea el cuadrado de 1024.
- Errores que conviene reconocer en el log: `HTTP 401` (clave inválida), `HTTP 403` (organización sin verificar o sin acceso al modelo), `HTTP 429 insufficient_quota` (sin saldo) y `HTTP 429 rate_limit_exceeded` (límite por minuto). Cada línea trae además `req=<id>` (el `x-request-id` de OpenAI: es lo que pide su soporte para rastrear un pedido) y, en los bloqueos de contenido, `etapa=` (`input` u `output`) y `categorias=`. Un `HTTP 400` con `unknown_parameter`, `invalid_value` o similar es un fallo de integración (`502 ai_error`), no un bloqueo. El navegador nunca recibe ese detalle.
- Compatibilidad: `POST /api/gemini/generate-image` sigue respondiendo (alias de `POST /api/ai/generate-image`) y la bandera pública `gemini.enabled` conserva el nombre.
- Encendido y apagado: solo en el servidor (clave cargada y `AI_IMAGE_PROVIDER`). El backoffice no tiene interruptor: muestra el estado y prueba la conexión. `gemini.enabled` y `aiImages` los publica el servidor en `/shared/js/app-config.json` y el navegador ya no los pisa con lo que tenga guardado (antes, el navegador que había usado el backoffice podía no ver "Generar referencia con IA" con la clave ya cargada).

---

## Ronda 2 · orden de despliegue y migraciones

Vale para el paso de **beta 2.4.0** a la rama `feature/beta-ronda-2` (migraciones
`supabase/migrations/20261116*.sql`, con su reversa en `supabase/rollbacks/`).
En la ronda anterior las migraciones se aplicaron antes del deploy; **esta vez es al revés**.

**Por qué.** Dos migraciones cambian reglas que el código de 2.4.0 no conoce, y con
2.4.0 todavía sirviendo dejan errores crudos en pantalla:

| Migración | Qué pasa con 2.4.0 corriendo |
|---|---|
| `20261116150000_sesiones_confirmacion_ubicacion.sql` | Las sesiones existentes quedan confirmadas. Reprogramar o borrar una sesión de una cotización con cuenta de cliente falla (`WOS01` / `WOS03`): 2.4.0 edita la sesión directo desde el navegador. |
| `20261116140000_negociacion_propuestas.sql` | Sella las cotizaciones aprobadas. "Editar acuerdo" falla (`42501`): 2.4.0 escribe `final_budget_amount`, `final_sessions` y `final_comment` directo. |

El código nuevo, en cambio, **sí funciona sin las migraciones**: negociación, sesiones,
favoritos, denuncias y enlaces de cotización responden "todavía no disponible"
(`GET /api/negociacion/quotations/:id` → `available:false`; las rutas de sesiones →
`503 sessions_unavailable` y la agenda sigue en el modo anterior) y lo que ya existía
no se rompe.

**Orden:**

1. **Primero el código.** Desplegar `feature/beta-ronda-2` (Opción B: reinicia PM2).
2. **Enseguida, en la misma ventana, las migraciones.** Aplicar todas las
   `supabase/migrations/20261116*.sql` en orden de nombre (timestamp) sobre
   `flbgmlvfiejfttlawnfu`. Las que se agreguen después de esta guía van al final,
   en el mismo orden.
3. **No aplicar `20261116140000` ni `20261116150000` mientras 2.4.0 esté sirviendo.**
   Si por algún motivo las migraciones tienen que ir primero, hacerlo pegado al
   deploy (minutos, no horas) y avisar que en ese rato fallan "Editar acuerdo" y
   reprogramar o borrar sesiones.
4. **Volver atrás.** Si se vuelve a 2.4.0 (`rollbackHold`), correr ANTES las reversas,
   en orden inverso al de aplicación; como mínimo
   `supabase/rollbacks/20261116150000_sesiones_confirmacion_ubicacion.down.sql` y después
   `supabase/rollbacks/20261116140000_negociacion_propuestas.down.sql`. Si no, 2.4.0
   queda con los mismos errores. Ojo: la reversa de `150000` borra los pedidos de
   cambio, los registros y las disputas de sesiones cargados desde el deploy.

**Comprobar** con el código y las migraciones ya puestos:

- Reprogramar una sesión confirmada de una cotización con cuenta de cliente pide
  el acuerdo de la otra parte (sin error crudo).
- "Edita el acuerdo" del expediente abre el formulario de cambio propuesto.
- `GET /api/negociacion/quotations/:id` devuelve `available` distinto de `false`.
- Panel del cliente: al agendar una sesión, la tarjeta de la cotización dice
  "Sesión por confirmar" y "Próxima cita" agrega "· por confirmar"; al mandar
  "Modificar", la tarjeta pasa a "Cambios propuestos por ti".
- Una cotización rechazada por el cliente no deja escribir en el chat a ninguna
  de las dos partes.
- Panel de soporte (`/support/dashboard#disputas`): la pestaña DISPUTAS lista las
  disputas de sesión. Al resolver o cerrar una, la cotización deja de figurar
  "En disputa" y las dos partes reciben el correo con la resolución.

### Contacto del cliente y verificación (P20, REQ-11) — decisión del dueño antes de publicar

Desde esta ronda el email, WhatsApp e Instagram del cliente los ve solo el tatuador
con `verification_state = 'Yes'` (o en una cotización manual suya). Al 2026-11-16 en
la base viva **no hay ningún tatuador verificado**: 125 en `No`, 1 en `Requested`, 0 en
`Yes`. Con el código puesto, todos los artistas dejan de ver el contacto.

El caso que más duele son las cotizaciones de clientes **sin cuenta**: ahí tampoco hay
chat (se habilita cuando el cliente crea su cuenta), así que el artista se queda sin
ninguna vía. Hoy son 9 activas con artista asignado (6 `pending`, 2 `responded`,
1 `en_progreso`). El candado ya lo dice ("tu propuesta le llega por correo y el chat
se habilita cuando la cree"), pero no reemplaza la decisión.

Antes del deploy, elegir una:

1. **Verificar desde soporte** (`/support/dashboard` → Verificación) a los artistas
   activos; como mínimo a los que tienen cotizaciones en curso (hoy son 6 artistas
   con 13 cotizaciones activas):

   ```sql
   select a.user_id, a.username, a.verification_state, count(*) as cotizaciones_activas,
          count(*) filter (where q.client_user_id is null) as de_invitados
     from public.quotations_db q
     join public.artists_db a on a.user_id = q.artist_id
    where q.quote_status in ('pending', 'responded', 'client_approved', 'en_progreso')
    group by 1, 2, 3
    order by de_invitados desc, cotizaciones_activas desc;
   ```

2. **Regla de transición con fecha**: tratar como verificados a los artistas con
   cotizaciones activas hasta que soporte los revise. No está implementada: es un
   cambio en `contactAccess` (`lib/cot-detalle.js`) y hay que pedirlo antes de publicar.

**Comprobar** después: con un artista verificado, el expediente muestra el contacto;
con uno sin verificar y un cliente sin cuenta, el candado no menciona el chat.

### El acuerdo necesita la aprobación del cliente con cuenta (2.5.1, REQ-13 B)

`20261117100000_acuerdo_requiere_aprobacion_del_cliente.sql` va **después del
código 2.5.1**, como el resto. Es la función `negociacion_quotation_guard` ya
aplicada con una regla más: el artista no pasa una cotización respondida a
`client_approved` desde el navegador si la cotización tiene una cuenta de
cliente vinculada (`client_user_id`). Con la 2.5.0 todavía sirviendo, el artista
no ve el motivo: al confirmar, el diálogo muestra "No pudimos guardar. Prueba
nuevamente." (ese código no muestra el texto que llega de la base) y el turno
apartado ya quedó reservado. Por eso la migración no va antes del código.

**Para volver atrás, al revés:** primero
`supabase/rollbacks/20261117100000_acuerdo_requiere_aprobacion_del_cliente.down.sql`
y después el código 2.5.0. La 2.5.1 sin la regla sigue sin ofrecer la acción; la
2.5.0 con la regla puesta reserva el turno apartado y después falla.

**Comprobar** con el código y la migración puestos: en una respondida con
cliente con cuenta, la barra del expediente no muestra "Agendar" y ni el
expediente ni la lista ofrecen el estado "Confirmada"; los dos dicen por qué en
una nota junto al estado. (El botón "Agendar" del resumen de la lista sigue
llevando al calendario, como antes.) El cliente la acepta desde su panel y
recién ahí "Agendar" abre "Agendar sesión 1 de N". En una respondida sin cuenta vinculada,
"Agendar" abre "Confirmar acuerdo y agendar" como antes. Una cotización manual o
una "Nueva cita" creada con el correo de un cliente registrado se comporta como
"con cuenta".

### Limpieza de `session_logs` (SEG-03)

El registro de sesión del navegador guardaba la dirección completa. En la base
quedaron `#access_token=…&refresh_token=…` de 6 usuarios (12 filas; también
`provider_token` de Google en algunas) y 962 direcciones con query o hash, a la
vista de soporte. El código nuevo ya guarda solo origen + ruta.

1. `20261116230000_session_logs_sin_tokens_en_url.sql` va **después del código**,
   como el resto. Vacía el detalle de las filas con tokens y recorta todas las
   direcciones. No tiene reversa (no hay nada que restaurar) y se puede volver a
   correr: conviene repetirla unos días después, por las pestañas que hayan
   quedado abiertas con la versión anterior.
2. **Paso manual del dueño, antes de la limpieza** (después ya no se ve quiénes
   eran): listar los usuarios afectados con

   ```sql
   select distinct user_id, user_email from public.session_logs
    where page_url ~* '(access_token|refresh_token|provider_token|provider_refresh_token)=';
   ```

   y cerrarles todas las sesiones desde el panel de Auth de Supabase (Users →
   el usuario → Sign out / cierre global). Así los `refresh_token` guardados
   dejan de servir. Los `access_token` vencen solos en una hora.
3. Comprobar: `select count(*) from public.session_logs where page_url ~ '[#?]'`
   da 0.

Queda sin tocar el detalle (`log_data`) de las otras filas: va comprimido y su
primera entrada repite la dirección con la que se abrió la página (por ejemplo
`?email=…&draft=…` del registro) y las direcciones completas de las llamadas a
la API. Los tokens de sesión que llegan por la dirección quedan en la misma
fila, que sí se vacía; el resto no se revisó entrada por entrada. Si se quiere
borrar también, es vaciar `log_data` de las filas anteriores al deploy.

### Avisos push heredados de 2.4.0 en la matriz del cliente (EP-13)

En 2.4.0 el panel del cliente guardaba `push: false` en los tres eventos de su
matriz (mensajes, cotizaciones, postulaciones) cada vez que tocaba un toggle de
Email, porque el push todavía no existía. El código nuevo lee ese `false` como
una elección de la persona: ese cliente no recibiría avisos dentro de la app ni
push. Al 2026-11-16 no hay ninguna fila así en la base viva (5 clientes con
preferencias guardadas, 0 con `push: false`); solo aparece si alguien guarda la
matriz en producción entre hoy y el deploy.

1. **Justo antes de publicar el código**, contar en `flbgmlvfiejfttlawnfu`:

   ```sql
   select count(*)
     from public.user_preferences up
     join public.clients_db c on c.user_id = up.user_id
    where (up.notification_prefs #>> '{mensajes,push}') = 'false'
       or (up.notification_prefs #>> '{cotizaciones,push}') = 'false'
       or (up.notification_prefs #>> '{postulaciones,push}') = 'false';
   ```

2. Si da 0, no hay nada que hacer.
3. Si da más de 0, limpiar el valor heredado **en la misma ventana del deploy**
   (después, un `false` puede ser alguien que apagó el push a propósito con la
   matriz nueva). Reemplazar la fecha por la hora en que quedó sirviendo el código
   nuevo y probarlo antes dentro de `begin; … rollback;`:

   ```sql
   update public.user_preferences up
      set notification_prefs = up.notification_prefs
            #- '{mensajes,push}' #- '{cotizaciones,push}' #- '{postulaciones,push}'
     from public.clients_db c
    where c.user_id = up.user_id
      and up.updated_at < '<fecha y hora del deploy, con zona>'
      and ((up.notification_prefs #>> '{mensajes,push}') = 'false'
        or (up.notification_prefs #>> '{cotizaciones,push}') = 'false'
        or (up.notification_prefs #>> '{postulaciones,push}') = 'false')
      and not exists (select 1 from public.artists_db a where a.user_id = up.user_id);
   ```

   Quita solo la clave `push` de esos tres eventos: el Email y el resto de las
   preferencias quedan igual, y sin la clave vale el valor por defecto (encendido).
   No toca a quien además tiene perfil de artista: `mensajes` y `cotizaciones` se
   comparten con la matriz del artista, que en 2.4.0 ya dejaba apagar el Push a
   mano. Esas filas, si las hay, se revisan una por una.
4. Comprobar: el conteo del paso 1 da 0 (o solo las filas de artistas que se
   dejaron a propósito).

### Correo "Tu perfil es Most Wanted" (EP-14) — decisión del dueño antes de encenderlo

Con la migración `20261116180000_perfil_insignias_most_wanted.sql` aplicada, el
servidor recalcula la insignia **a los 3 minutos de cada arranque** y después cada
`MOST_WANTED_INTERVAL_HOURS` (12 por defecto). A cada ganador nuevo le manda el
correo `artist_most_wanted_awarded`, salvo `MOST_WANTED_EMAILS=off`. El umbral es
bajo para una beta cerrada (puntaje de 12 o más con 2 señales: 2 cotizaciones y 1
visita ya dan 13) y el correo es de la cuenta: no pasa por la matriz de
notificaciones, así que el artista no lo puede silenciar.

1. **Antes del primer arranque con esa migración aplicada**, cargar en el `.env`
   del servidor `MOST_WANTED_EMAILS=off` y reiniciar PM2 con `--update-env`. Como
   en esta ronda el código va primero y las migraciones después, lo más simple es
   cargarla antes de desplegar el código.
2. La insignia se sigue calculando y mostrando con el correo apagado. Después del
   primer ciclo, revisar quién la ganó:

   ```sql
   select artist_user_id, zone_label, score, signals
     from public.artist_trend_scores
    where most_wanted;
   ```

3. Decidir con el dueño si el correo se enciende (quitar la variable o poner
   `MOST_WANTED_EMAILS=on`). Al encenderlo, el ciclo siguiente les avisa a los
   ganadores que todavía no recibieron el aviso de su racha.
4. Comprobar tras el deploy: el log no muestra `eventId=artist_most_wanted_awarded`
   y la bitácora de correos no tiene filas de ese evento.

`MOST_WANTED_INTERVAL_HOURS=0` apaga solo el ciclo del proceso de Node: la insignia
se sigue recalculando con el job `recalculate-most-wanted` de `pg_cron` (todos los
días 03:40 UTC) y con `POST /api/perfil/most-wanted/recalculate` (`X-Cron-Token`).
Ese endpoint también avisa a los ganadores, y respeta `MOST_WANTED_EMAILS=off`.
Detalle en [docs/PERFIL_INSIGNIAS.md](../docs/PERFIL_INSIGNIAS.md).

---

## Beta 2.6.0 · Feedback de la beta y Flash Tattoos

Dos migraciones nuevas: `20261117120000_beta_feedback.sql` (tabla `beta_feedback`) y
`20261117130000_flash_tattoos.sql` (origen `flash`, columna `flash_snapshot`,
`save_web_quotation` guarda la instantánea, reserva del flash único y sus guardas).
Las dos son compatibles con el código 2.5.2, así que **van ANTES del código 2.6.0**:
sin ellas, `/api/feedback` y `/api/flash/request` fallan. La de flash redefine
`save_web_quotation` a partir de la definición viva (`pg_get_functiondef` + reemplazos
verificados) y falla entera si la función cambió.

**Para volver atrás:** primero el código 2.5.2 y después las reversas en orden inverso
(`20261117130000_flash_tattoos.down.sql` y `20261117120000_beta_feedback.down.sql`).
La reversa de feedback borra los comentarios recibidos: exportarlos antes a CSV desde
`/support/dashboard#feedback`.

**Comprobar** después: el botón «Comentarios» aparece con sesión de artista, cliente o
estudio y no en páginas públicas ni en soporte; un comentario llega a la pestaña
Feedback de soporte. En un perfil con flashes con precio, «Reservar este flash» abre
`/flash` y la solicitud llega al artista con la insignia Flash y el precio cargado.
Desde la 2.6.1 los correos «Nueva solicitud» y «Nueva solicitud con turno» muestran
el flash y su precio (los arma el servidor y salen por el relé; no hay que tocar n8n).

---

## Beta 2.7.0 · Identidad, denuncias abiertas, sanciones y copias de imágenes

Plan: [docs/plans/2026-11-18-kyc-antisuplantacion.md](../docs/plans/2026-11-18-kyc-antisuplantacion.md).

### 1. Variable de entorno nueva: `BAN_HMAC_KEY`

Clave de las huellas de cuentas baneadas (HMAC-SHA256 de correo, teléfono e
Instagram) y de la firma de los enlaces de apelación. 32 bytes aleatorios en base64,
**generada en el servidor y sin mostrarla** (no copiarla en el chat ni en un log):

```bash
# En el servidor, una sola vez:
cd ~/weotzi-deploy/shared
grep -q '^BAN_HMAC_KEY=.\+' main.env || \
  echo "BAN_HMAC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" >> main.env
chmod 600 main.env
PM2_HOME=~/weotzi-deploy/pm2 pm2 restart weotzi-beta --update-env
```

- **Si falta o no es válida:** el servidor arranca igual y **falla abierta**: los
  cierres no guardan huellas, el registro no bloquea el reingreso y el correo de
  sanción sale sin enlace de apelación. El log lo avisa una vez
  (`[ban-identifiers] BAN_HMAC_KEY …`).
- **Si se pierde o se cambia:** las huellas guardadas dejan de coincidir y los
  enlaces de apelación ya enviados dejan de valer. Guardar una copia en el gestor de
  secretos del dueño. No rotarla sin un plan para volver a calcular las huellas.

### 2. Migraciones, en este orden y ANTES del código 2.7.0

| Orden | Migración | Qué hace |
|---|---|---|
| 1 | `20261118100000_insignia_instagram.sql` | La insignia exige Instagram validado (columna `instagram_badge_ok`, `request_artist_verification`). |
| 2 | `20261118110000_denuncias_abiertas.sql` | Clientes pueden denunciar; motivos `plagio_diseno` y `estafa`. |
| 3 | `20261118120000_terminos_reaceptacion.sql` | Tabla `terms_acceptances` y versión de Términos `2026-11-18`. |
| 4 | `20261118130000_account_sanctions.sql` | `account_sanctions`, `banned_identifiers`, `security_alerts`, `sanction_state` en artistas y estudios, `support_closed_reason`, `revoke_user_sessions`; oculta perfiles y estudios sancionados (vistas, políticas y funciones de la Store). |
| 5 | `20261118140000_image_fingerprints.sql` | `image_fingerprints`, cola, `design_search_log`, disparadores de imágenes y RPC del buscador. |

Cada una se valida antes con `execute_sql` dentro de `begin … rollback` en el
proyecto vivo (`flbgmlvfiejfttlawnfu`) y se aplica después de aprobar el PR. Son
compatibles con el código 2.6.1: aplicarlas primero y desplegar el código después.
Sin la 4, `/api/support/sanctions…` y `/api/sanctions/appeal` responden
503 `MIGRATION_PENDING` y la pestaña Sanciones lo dice.

**Para volver atrás:** primero el código 2.6.1 y después las reversas en orden
inverso (`supabase/rollbacks/20261118140000…` → `…100000`). La reversa de sanciones
borra las sanciones, las huellas y las alertas: antes, levantar desde el panel las
sanciones vigentes para que Auth desbloquee esas cuentas (la reversa no toca Auth).

### 3. Antes de abrir: insignias, Términos y buscador

- **Insignias:** desde la 1 (`insignia_instagram`) la insignia exige Instagram validado. Hoy ningún artista ni estudio tiene Instagram validado: el único estudio verificado pierde el sello hasta que soporte confirme su Instagram (Verificación de estudios → «Confirmar Instagram»).
- **Términos:** todos los usuarios ven el aviso «Actualizamos los Términos…» al iniciar sesión (versión `2026-11-18`).
- **Copias de imágenes y buscador `/buscar-diseno`:** necesitan la librería `sharp` (auditoría: [docs/plans/2026-11-18-auditoria-sharp.md](../docs/plans/2026-11-18-auditoria-sharp.md)). Sin ella el motor queda apagado y el buscador responde «El buscador se habilita pronto.». Con `sharp` instalada, después del despliegue: `node scripts/backfill-image-fingerprints.js --dry-run` y luego sin `--dry-run` (avisa a soporte las copias que ya existan). `IMAGE_FP_JOB=off` apaga el motor.

### 4. Soporte: dos agentes

Un cierre permanente lo propone un agente y lo confirma **otro** (lo exige la base).
Hoy hay un solo agente activo en `support_users_db`; el superadmin del backoffice
cuenta como segundo agente. Una apelación la decide un agente que no propuso ni
confirmó: con un solo agente más el superadmin, una apelación de un cierre que
propuso uno y confirmó el otro **no la puede decidir nadie**. Crear un segundo
agente de soporte antes de usar sanciones en serio.

Las suspensiones vencidas se levantan solas: `lib/routes/sanciones.js` (al
registrarse en `server.js`) arranca un temporizador que corre cada 10 minutos
(la primera pasada, un minuto después de arrancar). No hace falta cron. Con varias
instancias de PM2 cada una corre el suyo; no se pisan porque aplicar o levantar
una sanción toma un turno en `account_sanctions.side_effects.running` (vence a
los 5 minutos si el proceso se cae a mitad). Si dos agentes actúan a la vez sobre
la misma sanción, el segundo recibe «Otro agente la está aplicando o levantando…»
y solo tiene que actualizar.

### 5. Comprobar después del despliegue

- `/support/dashboard#sanciones` abre la pestaña con las sub-vistas Propuestas,
  Activas, Apeladas, Levantadas y Alertas.
- Con una cuenta de prueba: proponer una advertencia (se aplica y llega el correo con
  el enlace a `/apelacion`), abrir el enlace y apelar una vez; la segunda vez dice
  «Ya enviaste tu apelación».
- Proponer un cierre con un agente: el botón Confirmar queda deshabilitado para él y
  habilitado para el otro. Al confirmar: el perfil sale del explorador, la cuenta no
  puede iniciar sesión, y registrarse de nuevo con el mismo correo muestra «No podemos
  crear esta cuenta…» y deja una alerta «Reingreso bloqueado».
- Levantar la sanción de prueba: el perfil vuelve, Auth desbloquea y se borran sus
  huellas.

## Reglas para el agente

| Situación                                           | Acción                                      |
|-----------------------------------------------------|---------------------------------------------|
| Solo cambiaron archivos en `public/`                | Despliegue parcial, **sin reiniciar PM2**   |
| Cambió `server.js`, `package.json` o `ecosystem`   | Despliegue completo + reiniciar PM2         |
| Error `node: command not found`                     | Agregar `/opt/alt/alt-nodejs22/root/bin` al PATH |
| PM2 no responde                                     | Verificar `PM2_HOME=/home/u795331143/.pm2`  |
| Puerto 4545 sin respuesta                           | `pm2 start ecosystem.config.js`             |

---

## Verificación post-despliegue

1. `pm2 list` muestra `weotzi-beta` en estado `online`
2. `curl http://127.0.0.1:4545/` devuelve `200` o `302`
3. No hay errores nuevos en los logs
4. URL pública responde: `https://beta.weotzi.com`

---

## Archivos modificados recientemente (referencia)

| Archivo                              | Cambio                                          |
|--------------------------------------|-------------------------------------------------|
| `lib/postgrest.js`, `lib/repos/`, `lib/auth/` | Capa PostgREST unificada (servidor) — 2026-06-21 |
| `public/shared/js/data/`             | Capa PostgREST unificada (frontend, `window.WeotziData`) |
| `server.js` + 13 módulos `public/shared/js/` | Dominio cotizaciones migrado a la capa (Opción B: reinicia PM2) |
| `public/shared/js/script.js`         | Guard anti-duplicados en `submitQuotation()`    |
