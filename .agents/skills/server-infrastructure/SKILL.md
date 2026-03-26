---
name: server-infrastructure
description: Manage the We Otzi production server on Hostinger. SSH access, deployments, PM2 process management, logs, diagnostics, .htaccess routing, and Node.js app lifecycle for beta.weotzi.com. Use when the user mentions server, deploy, hosting, PM2, SSH, production, beta.weotzi.com, server status, logs, restart, or Hostinger.
---

# We Otzi Server Infrastructure Manager

## Quick Reference

| Key | Value |
|-----|-------|
| Host | `92.112.189.44` |
| SSH Port | `65002` |
| Username | `u795331143` |
| Credentials file | `.server-credentials` (project root) |
| Hosting | Hostinger Shared (Apache + CloudLinux) |
| Hostname | `us-bos-web1627.main-hosting.eu` |

### Domains & Sites

| Domain | Path | Type |
|--------|------|------|
| `weotzi.com` | `/home/u795331143/domains/weotzi.com/public_html/` | WordPress (landing page) |
| `beta.weotzi.com` | `/home/u795331143/domains/weotzi.com/public_html/beta/` | Node.js app (Express) |
| `bangtanstylefbar.com` | `/home/u795331143/domains/bangtanstylefbar.com/` | Separate site |

### Node.js App (beta.weotzi.com)

| Key | Value |
|-----|-------|
| App directory | `/home/u795331143/domains/weotzi.com/public_html/beta/` |
| PM2 process name | `weotzi-beta` |
| App port | `4545` |
| PM2 config | `ecosystem.config.js` |
| Routing chain | Apache -> `.htaccess` -> `proxy.php` -> Node.js `:4545` |

---

## SSH Connection

**Always use paramiko** (Python) for SSH because Hostinger requires password auth and the system is on Windows. Never use raw `ssh` commands.

```python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('92.112.189.44', port=65002, username='u795331143', password='Abnerisai24.')
# Execute commands...
stdin, stdout, stderr = ssh.exec_command('command here')
stdout.channel.recv_exit_status()
output = stdout.read().decode('utf-8', errors='replace')
ssh.close()
```

Read credentials from `.server-credentials` when writing reusable scripts.

---

## Node.js Environment

Node.js is NOT in the default PATH on Hostinger. Always prepend the correct path.

```bash
export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH
```

Available versions: `alt-nodejs18`, `alt-nodejs20`, `alt-nodejs22`, `alt-nodejs24`. Currently using **nodejs22**.

Alternative node binary path: `/opt/alt/alt-nodejs22/root/usr/bin/node`

---

## PM2 Management

PM2 is installed locally (not global). Two possible locations:

| Context | PM2 binary | PM2_HOME |
|---------|-----------|----------|
| From beta dir | `./node_modules/.bin/pm2` | `/home/u795331143/.pm2-beta` |
| Global user install | `/home/u795331143/node_modules/pm2/bin/pm2` | `/home/u795331143/.pm2` |

**Standard env setup for running PM2 commands:**

```bash
export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH
export PM2_HOME=/home/u795331143/.pm2
cd /home/u795331143/domains/weotzi.com/public_html/beta
```

### Common PM2 Operations

| Operation | Command |
|-----------|---------|
| List processes | `./node_modules/.bin/pm2 list` |
| Start with ecosystem | `./node_modules/.bin/pm2 start ecosystem.config.js` |
| Restart app | `./node_modules/.bin/pm2 restart weotzi-beta` |
| Stop app | `./node_modules/.bin/pm2 stop weotzi-beta` |
| Delete process | `./node_modules/.bin/pm2 delete weotzi-beta` |
| View logs | `./node_modules/.bin/pm2 logs weotzi-beta --lines 50 --nostream` |
| Save state | `./node_modules/.bin/pm2 save` |
| Monitor | `./node_modules/.bin/pm2 monit` |
| Flush logs | `./node_modules/.bin/pm2 flush` |

### Full restart procedure

```bash
ENV="export PATH=/opt/alt/alt-nodejs22/root/bin:$PATH && export PM2_HOME=/home/u795331143/.pm2"
DIR="/home/u795331143/domains/weotzi.com/public_html/beta"
PM2="./node_modules/.bin/pm2"

# Stop and delete
$ENV && cd $DIR && $PM2 delete weotzi-beta
# Start fresh
$ENV && cd $DIR && $PM2 start ecosystem.config.js
# Save state
$ENV && cd $DIR && $PM2 save
# Verify
$ENV && cd $DIR && $PM2 list
# Test local connectivity
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4545/
```

---

## Routing Architecture

```
Client -> beta.weotzi.com -> Apache -> .htaccess -> proxy.php -> http://127.0.0.1:4545
```

- `.htaccess`: Uses `DirectoryIndex proxy.php` and mod_rewrite to route all non-file requests through `proxy.php`
- `proxy.php`: cURL-based reverse proxy forwarding to Node.js on port 4545
- Strips `/beta` prefix from request URI before proxying

If the app shows a blank page or errors, check in order:
1. Is PM2 running? (`pm2 list`)
2. Is the port responding? (`curl http://127.0.0.1:4545/`)
3. Is `.htaccess` correct?
4. Is `proxy.php` pointing to the right port?

---

## Deployment

Use `scripts/deploy_beta.py` to deploy to beta.weotzi.com:

1. Creates a ZIP of the project (excluding node_modules, .git, scripts, .cursor)
2. Uploads via SCP to `/home/u795331143/domains/weotzi.com/public_html/beta/`
3. Unzips on server
4. Runs `npm install --production`
5. Restarts PM2 process

**Manual deployment** (when you need more control):

```python
# Upload specific files via SCP
from scp import SCPClient
with SCPClient(ssh.get_transport()) as scp:
    scp.put('local_file', remote_path='/home/u795331143/domains/weotzi.com/public_html/beta/local_file')
```

### Post-deployment verification

1. Check PM2 status
2. `curl http://127.0.0.1:4545/` returns 200/302
3. `curl https://beta.weotzi.com/quotation/` returns 200
4. Check PM2 logs for errors

---

## PHP Management Endpoints

The server has PHP scripts for remote management (require security token `Abnerisai24.`):

| Script | URL | Purpose |
|--------|-----|---------|
| `start_server.php` | `beta.weotzi.com/start_server.php?token=...` | Start PM2 process |
| `stop_server.php` | `beta.weotzi.com/stop_server.php?token=...` | Stop PM2 process |
| `server_status.php` | `beta.weotzi.com/server_status.php?token=...` | Check server status |
| `server_logs.php` | `beta.weotzi.com/server_logs.php?token=...` | View application logs |
| `auto_monitor.php` | `beta.weotzi.com/auto_monitor.php` | Auto-restart if crashed |

---

## Diagnostics Checklist

When something is wrong:

1. **SSH connect** - Verify you can reach the server
2. **PM2 list** - Is the process running?
3. **PM2 logs** - Any errors or crashes?
4. **Port test** - `curl http://127.0.0.1:4545/` responds?
5. **Disk space** - `df -h /`
6. **Memory** - `free -h`
7. **Node version** - Using correct alt-nodejs version?
8. **Dependencies** - `npm install` ran successfully?
9. **Crash log** - `cat crash_history.log | tail -50`
10. **Public URL** - `curl https://beta.weotzi.com/` returns expected response?

---

## Utility Scripts

Pre-built scripts in `.agents/skills/server-infrastructure/scripts/`:

- `server_status.py` - Full health check (PM2, port, disk, memory, logs)
- `server_restart.py` - Clean restart of the Node.js app
- `server_deploy.py` - Deploy specific files to the server
- `server_logs.py` - Fetch and display recent PM2 logs

See [reference.md](reference.md) for detailed server file inventory and configuration details.

---

## Known Issues & Gotchas

1. **PM2_HOME inconsistency**: Some scripts use `.pm2-beta`, some use `.pm2`. The `ecosystem.config.js` logs go to `.pm2/logs/`. Standardize on `/home/u795331143/.pm2` with `start_server.php`.

2. **No crontab**: No auto-restart on server reboot. PM2 startup script can't be set on shared hosting. Use `auto_monitor.php` as a workaround or Hostinger's cron job feature in hPanel.

3. **No .env on server**: Environment variables for Supabase, Google APIs, etc. are NOT set on the server. The app falls back to `app-config.json` file for client-side config. Server-side endpoints that need `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` will fail without env vars.

4. **Node not in PATH**: Always add `/opt/alt/alt-nodejs22/root/bin` to PATH before running node/npm/pm2.

5. **File encoding**: When printing SSH output on Windows, use `errors='replace'` to handle non-ASCII characters.

6. **deploy.py targets /app which doesn't exist**: The `scripts/deploy.py` targets `public_html/app/` but that directory doesn't exist on the server. Only `public_html/beta/` is deployed. Use `deploy_beta.py` instead.
