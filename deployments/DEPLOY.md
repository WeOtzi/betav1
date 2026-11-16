# Guía de Despliegue — We Ötzi Beta

> Documento para agentes y desarrolladores. Cubre despliegue completo y parcial al servidor de producción `beta.weotzi.com`.

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
| `OPENAI_API_KEY` | `sk-…` | Clave de la API de OpenAI. **Secreta.** Es la misma que usa el chat de soporte (`SUPPORT_CHAT_ENABLED`) |
| `AI_IMAGE_PROVIDER` | vacío / `openai` / `gemini` / `off` | Vacío: OpenAI si hay `OPENAI_API_KEY`; si no, Gemini si hay `GEMINI_API_KEY`. `gemini` fuerza el proveedor heredado. `off` apaga las imágenes con IA aunque haya claves (el chat de soporte sigue) |
| `AI_IMAGE_MODEL` | `gpt-image-2.6-flare` (default) / `gpt-image-2.6-sunburst` | Modelo general. `flare` es el rápido de uso cotidiano; `sunburst`, el de trabajo detallado. Un valor desconocido cae al default |
| `AI_REFERENCE_MODEL` | mismos valores | Modelo de la referencia con IA del cotizador. Vacío o desconocido (p. ej. un ID viejo de Gemini): usa `AI_IMAGE_MODEL` |
| `AI_IMAGE_QUALITY` | `low` / `medium` (default) / `high` | Calidad pedida a OpenAI. Más calidad = más costo y más espera |
| `AI_IMAGE_TIMEOUT_MS` | ms; default `120000` | Espera máxima al proveedor. Vencida, el endpoint responde 504 |
| `AI_REFERENCE_DAILY_CAP` | default `300` | Tope diario de imágenes del cotizador (por proceso) |
| `AI_IMAGE_DAILY_CAP` | default `500` | Tope diario del endpoint genérico (`GEMINI_DAILY_CAP` sigue valiendo como alias) |
| `GEMINI_API_KEY` | `AIza…` | Solo para el proveedor heredado |

Alta (una sola vez):

1. Crear la clave en la consola de OpenAI (conviene un proyecto propio con límite de gasto mensual) y cargar `OPENAI_API_KEY` en el `.env` del servidor.
2. **Verificar la organización en OpenAI** si la consola lo pide: los modelos GPT Image pueden exigirlo. Sin esa verificación la API responde 403 y la plataforma muestra "No pudimos generar la imagen" (`502 ai_error`); el motivo queda en el log: `[ai-image] generación: provider HTTP 403 …`.
3. Reiniciar PM2 con `--update-env` (es un despliegue de Opción B: cambian `server.js` y `lib/`).
4. Probar: Backoffice → APIs → **IA de imágenes (OpenAI)** → **Probar** (genera una imagen real: consume cuota). "Probar todas las conexiones" y `GET /api/health/gemini` (clave histórica del servicio) consultan el modelo sin generar nada ni gastar cuota, y devuelven `metadata.provider` y `metadata.model`.

Notas:

- **Tiempo de espera y proxy.** Una imagen puede tardar entre 30 y 90 s en calidad media o alta. El proxy PHP público (`deployments/hostinger/proxy.php`) corta cada pedido a los **60 s** (`CURLOPT_TIMEOUT`): si la generación tarda más, el navegador recibe un 502 del proxy aunque el servidor termine bien (y la imagen se paga igual). Mientras ese límite no se suba para estas rutas, conviene `AI_IMAGE_TIMEOUT_MS=55000` (el servidor corta antes, con un 504 claro) y, si hay muchos cortes, `AI_IMAGE_QUALITY=low`.
- Qué viaja a OpenAI: el prompt (en el cotizador lo arma el servidor con la idea, el estilo, la zona y el color), el modelo, el tamaño y un `safety_identifier` (SHA-256 de la llave del borrador o del id de la cuenta). Nunca email, nombre ni IP. La política de privacidad (sección 6) nombra a OpenAI como proveedor: si se activa el proveedor heredado (Gemini), hay que actualizarla antes.
- Límites propios: 6 imágenes por borrador y 30 por IP por hora en el cotizador; 20 por hora por IP en el endpoint genérico; más los topes diarios de la tabla. En el cotizador, lo que no genera imagen no descuenta del tope diario.
- Errores que conviene reconocer en el log: `HTTP 401` (clave inválida), `HTTP 403` (organización sin verificar o sin acceso al modelo), `HTTP 429 insufficient_quota` (sin saldo) y `HTTP 429 rate_limit_exceeded` (límite por minuto). El navegador nunca recibe ese detalle.
- Compatibilidad: `POST /api/gemini/generate-image` sigue respondiendo (alias de `POST /api/ai/generate-image`) y la bandera pública `gemini.enabled` conserva el nombre.

---

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
