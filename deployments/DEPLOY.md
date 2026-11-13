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
