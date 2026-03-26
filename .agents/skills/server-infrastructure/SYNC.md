# Instrucciones de Sincronización Local → Servidor

**Agente:** server-infrastructure
**Objetivo:** Subir cambios del repositorio local a `beta.weotzi.com` (Hostinger)
**Servidor remoto:** `/home/u795331143/domains/weotzi.com/public_html/beta/`

---

## Regla de decisión: ¿qué método usar?

```
¿Cambió server.js, package.json o ecosystem.config.js?
  ├── SÍ → Full Deploy (deploy_beta.py)  — npm install + PM2 restart
  └── NO → ¿Solo cambiaron archivos en public/ o archivos .php/.htaccess?
              ├── SÍ → Targeted Deploy (server_deploy.py)  — sin restart
              └── MIXTO → Targeted Deploy con --restart
```

| Tipo de cambio | Método | PM2 restart |
|---|---|---|
| `server.js` modificado | Full deploy | Sí |
| `package.json` modificado (deps nuevas) | Full deploy | Sí |
| `ecosystem.config.js` modificado | Targeted + restart | Sí |
| `public/**` (HTML, CSS, JS frontend) | Targeted | No |
| `proxy.php`, `.htaccess` | Targeted | No |
| `start_server.php`, `auto_monitor.php`, etc. | Targeted | No |

---

## Método 1: Targeted Deploy — archivos específicos

Usa este script para subir archivos individuales sin tocar PM2.

**Script:** `.agents/skills/server-infrastructure/scripts/server_deploy.py`

```bash
# Subir un archivo (sin reiniciar PM2)
python .agents/skills/server-infrastructure/scripts/server_deploy.py public/shared/js/dashboard.js

# Subir varios archivos
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/js/dashboard.js \
  public/shared/js/script.js \
  public/shared/css/styles.css

# Subir y reiniciar PM2 (cuando cambia lógica de servidor)
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  server.js \
  --restart
```

**Prerrequisitos:**
- Python instalado con `paramiko` y `scp` (`pip install paramiko scp`)
- Archivo `.server-credentials` presente en la raíz del proyecto
- Ejecutar desde la raíz del proyecto

---

## Método 2: Full Deploy — paquete completo

Usa este script cuando haya cambios en dependencias Node.js o en `server.js`.

**Script:** `scripts/deploy_beta.py`

```bash
# Desde la raíz del proyecto
python scripts/deploy_beta.py
```

**Qué hace internamente:**
1. Crea un ZIP del proyecto (excluye `node_modules/`, `.git/`, `scripts/`, `.cursor/`)
2. Sube el ZIP al servidor vía SCP
3. Descomprime en `/public_html/beta/`
4. Ejecuta `npm install --production`
5. Reinicia PM2 (`pm2 delete weotzi-beta` + `pm2 start ecosystem.config.js`)

**Tiempo estimado:** 2-4 minutos según tamaño del proyecto.

---

## Verificación post-sync

Siempre verificar después de subir:

### Verificación rápida (targeted deploy sin restart)
```bash
# Confirmar que el archivo fue subido correctamente (opcional via SSH)
# La ausencia de errores en server_deploy.py es suficiente indicador
```

### Verificación completa (full deploy o restart)

Ejecutar en orden:

```bash
# 1. Verificar que PM2 está corriendo
python .agents/skills/server-infrastructure/scripts/server_status.py
```

O manualmente vía SSH:
```python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.112.189.44', port=65002, username='u795331143', password='Abnerisai24.')

# PM2 status
stdin, stdout, stderr = ssh.exec_command(
    'export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2 && '
    'cd /home/u795331143/domains/weotzi.com/public_html/beta && '
    './node_modules/.bin/pm2 list'
)
stdout.channel.recv_exit_status()
print(stdout.read().decode('utf-8', errors='replace'))

# Puerto local
stdin, stdout, stderr = ssh.exec_command('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4545/')
stdout.channel.recv_exit_status()
print('Port 4545:', stdout.read().decode().strip())

ssh.close()
```

**Resultados esperados:**
- PM2 lista el proceso `weotzi-beta` como `online`
- `curl http://127.0.0.1:4545/` responde `200` o `302`
- `https://beta.weotzi.com/quotation/` responde `200`

---

## Archivos excluidos del sync

Nunca subir estos archivos al servidor:

| Archivo/Directorio | Razón |
|---|---|
| `node_modules/` | Se instala con `npm install` en el servidor |
| `.git/` | El servidor tiene su propio `.git` |
| `scripts/` | Scripts locales de desarrollo/deploy |
| `.cursor/`, `.claude/`, `.agents/` | Herramientas locales de desarrollo |
| `*.py` | Scripts Python solo corren localmente |
| `*.zip` | Artefactos temporales de deploy |
| `.server-credentials` | Credenciales sensibles |
| `docs/superpowers/` | Documentación interna de desarrollo |

---

## Credenciales del servidor

Leer siempre desde `.server-credentials` en la raíz del proyecto:

```
SSH_HOST=92.112.189.44
SSH_PORT=65002
SSH_USER=u795331143
SSH_PASS=Abnerisai24.
```

Los scripts `server_deploy.py` y `server_status.py` ya leen este archivo automáticamente.

---

## Casos comunes de sync

### Caso A: Actualicé solo archivos del frontend (HTML/CSS/JS en `public/`)

```bash
# Listar archivos modificados
git diff --name-only HEAD

# Subir todos los archivos modificados en public/
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/js/dashboard.js \
  public/shared/css/dashboard.css \
  public/artist/dashboard/index.html
# Sin --restart
```

### Caso B: Actualicé `server.js`

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py server.js --restart
# Verificar PM2 después
```

### Caso C: Instalé una dependencia nueva (`npm install <pkg> --save`)

```bash
# Full deploy necesario porque package.json y node_modules cambiaron
python scripts/deploy_beta.py
```

### Caso D: Cambié `ecosystem.config.js` (variables de entorno, límites de memoria, etc.)

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py ecosystem.config.js --restart
```

### Caso E: El servidor está caído (PM2 no responde)

```bash
# Intentar restart via PHP endpoint primero
# GET https://beta.weotzi.com/start_server.php?token=Abnerisai24.

# Si no funciona, conectar por SSH y reiniciar manualmente:
python -c "
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.112.189.44', port=65002, username='u795331143', password='Abnerisai24.')
ENV = 'export PATH=/opt/alt/alt-nodejs22/root/bin:\$PATH && export PM2_HOME=/home/u795331143/.pm2'
DIR = '/home/u795331143/domains/weotzi.com/public_html/beta'
PM2 = './node_modules/.bin/pm2'
cmd = f'{ENV} && cd {DIR} && {PM2} delete weotzi-beta; {PM2} start ecosystem.config.js && {PM2} save'
stdin, stdout, stderr = ssh.exec_command(cmd)
stdout.channel.recv_exit_status()
print(stdout.read().decode('utf-8', errors='replace'))
ssh.close()
"
```

---

## Sync de la implementación HEIC (ejemplo de uso real)

Los siguientes archivos fueron modificados en la implementación de compatibilidad HEIC. Para sincronizarlos con el servidor:

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/js/heic-converter.js \
  public/artist/dashboard/index.html \
  public/quotation/index.html \
  public/job-board/request/index.html \
  public/shared/js/dashboard.js \
  public/shared/js/script.js \
  public/shared/js/job-board-request.js
```

**Sin `--restart`** — todos son archivos frontend estáticos. PM2/Node.js no necesita reiniciarse.

---

## Diagnóstico rápido de problemas post-sync

| Síntoma | Causa probable | Acción |
|---|---|---|
| Página en blanco o error 502 | PM2 caído | Ejecutar `server_restart.py` o PHP endpoint |
| Cambios no visibles | Caché del navegador | Ctrl+Shift+R en el browser |
| Cambios no visibles en servidor | Archivo no subido | Verificar output de `server_deploy.py` |
| `weotzi-beta` aparece `errored` en PM2 | Error en `server.js` | Revisar logs: `server_logs.py` |
| `npm install` falla en full deploy | Incompatibilidad de versión | Revisar `package.json`, probar `alt-nodejs20` |

Para ver logs de PM2:
```bash
python .agents/skills/server-infrastructure/scripts/server_logs.py
```

---

## Referencia rápida de rutas

| Local | Servidor |
|---|---|
| `./server.js` | `/home/u795331143/domains/weotzi.com/public_html/beta/server.js` |
| `./public/` | `/home/u795331143/domains/weotzi.com/public_html/beta/public/` |
| `./ecosystem.config.js` | `/home/u795331143/domains/weotzi.com/public_html/beta/ecosystem.config.js` |
| `./package.json` | `/home/u795331143/domains/weotzi.com/public_html/beta/package.json` |
