# Server Reference - We Otzi (Hostinger)

## Server File Inventory

### `/home/u795331143/domains/weotzi.com/public_html/beta/`

| File | Purpose |
|------|---------|
| `server.js` | Main Express application (same as local `server.js`) |
| `package.json` | Dependencies and scripts |
| `ecosystem.config.js` | PM2 configuration (port 4545, memory limit 300M) |
| `.htaccess` | Apache rewrite rules -> proxy.php |
| `proxy.php` | cURL reverse proxy to Node.js :4545 |
| `start_server.php` | PHP script to start PM2 (token-protected) |
| `stop_server.php` | PHP script to stop PM2 (token-protected) |
| `server_status.php` | PHP script for status check |
| `server_logs.php` | PHP script to view logs |
| `auto_monitor.php` | Auto-restart script for crashed processes |
| `crash_history.log` | Log of crashes and restarts |
| `setup.js` | Installer bootstrapper |
| `default.php` | Hostinger default page |
| `public/` | Static frontend files (HTML, CSS, JS) |
| `node_modules/` | Node.js dependencies |
| `.git/` | Git repository on server |
| `docs/` | Documentation directory |
| `installer/` | Installation scripts directory |
| `scripts/` | Deployment/management scripts |

### `/home/u795331143/domains/weotzi.com/public_html/` (root)

WordPress installation for weotzi.com landing page. Key files:
- `wp-config.php` - WordPress configuration
- `wp-admin/` - WordPress admin panel
- `wp-content/` - WordPress themes, plugins, uploads
- `.htaccess` - WordPress rewrite rules

---

## ecosystem.config.js Details

```javascript
module.exports = {
  apps: [{
    name: 'weotzi-beta',
    script: 'server.js',
    env: {
      PORT: 4545,
      NODE_ENV: 'production'
    },
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 3000,
    exp_backoff_restart_delay: 100,
    max_memory_restart: '300M',
    error_file: '/home/u795331143/.pm2/logs/weotzi-beta-error.log',
    out_file: '/home/u795331143/.pm2/logs/weotzi-beta-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    watch: false,
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
```

---

## .htaccess Configuration

```apache
DirectoryIndex proxy.php
RewriteEngine On

# If the request is for a real file or directory, serve it
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Route everything else through proxy.php
RewriteRule ^(.*)$ proxy.php [L,QSA]
```

---

## proxy.php Flow

1. Receives all non-file requests via `.htaccess` rewrite
2. Strips `/beta` prefix from request URI
3. Forwards to `http://127.0.0.1:4545` via cURL
4. Passes through headers, body, and HTTP method
5. Returns Node.js response to the client

---

## start_server.php Details

- Security token: `Abnerisai24.` (passed as `?token=` query parameter)
- Node binary: `/opt/alt/alt-nodejs22/root/usr/bin/node`
- PM2 binary: `/home/u795331143/node_modules/pm2/bin/pm2`
- PM2_HOME: `/home/u795331143/.pm2`
- Steps: Delete existing process -> Start with ecosystem.config.js -> Save

---

## Express Server Endpoints

The Node.js app exposes these API routes:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/gemini/generate-image` | Gemini AI image generation |
| POST | `/api/google-drive/test` | Test Google Drive connection |
| POST | `/api/google-drive/create-quote-folder` | Create quote folder & upload images |
| GET | `/api/client-info` | Get client IP address |
| POST | `/api/session-log` | Receive session log data |
| POST | `/api/admin/update-user-password` | Update user password via Supabase Admin |
| POST | `/api/auth/reset-temp-password` | Reset temp password for email flow |
| POST | `/api/admin/generate-backup` | Generate full system backup ZIP |
| GET | `/api/admin/backup-tables` | List available backup tables |
| GET | `/shared/js/app-config.json` | Dynamic config with env overrides |
| POST | `/api/job-board/accept-application` | Accept job board application |

Frontend routes (served as static HTML):
`/registerclosedbeta`, `/register-artist`, `/artist/dashboard`, `/artist/profile`,
`/my-quotations`, `/calendar`, `/archive`, `/quotation`, `/marketplace`,
`/backoffice`, `/support/login`, `/support/dashboard`, `/tutorial`,
`/client/login`, `/client/register`, `/client/dashboard`,
`/job-board`, `/job-board/request`

---

## Deployment Scripts in Project

| Script | Target | Purpose |
|--------|--------|---------|
| `scripts/deploy_beta.py` | `public_html/beta/` | Full deploy to beta.weotzi.com |
| `scripts/deploy.py` | `public_html/app/` | Deploy to app (dir doesn't exist yet) |
| `scripts/diagnose_remote.py` | beta | Remote diagnostics |
| `scripts/fix_remote_port.py` | beta | Fix port + upload configs |
| `scripts/check_node_path.py` | - | Verify Node.js installation |
| `scripts/deploy_logout_changes.py` | - | Deploy specific logout changes |
| `scripts/list_remote.py` | - | List remote directory contents |
| `scripts/verify_server_paths.py` | - | Verify server file paths |

---

## Hostinger hPanel

Accessible at https://hpanel.hostinger.com for:
- Domain management
- SSL certificates
- File manager (web-based)
- Database management
- Cron jobs configuration
- PHP version management
- Error logs (Apache)
- Backups
