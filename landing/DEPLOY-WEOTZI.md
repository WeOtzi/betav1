# DEPLOY-WEOTZI.md — Reemplazar el WordPress de weotzi.com por el sitio estático

Guía para poner en producción el nuevo sitio estático de **https://weotzi.com/** (carpeta `landing/` de este repo) en lugar del WordPress actual.

> **Regla de oro**: la raíz del sitio en producción es el **contenido** de `landing/`. Todas las rutas internas del sitio son root-absolutas (`/shared/css/site.css`, `/assets/...`), así que el sitio **solo funciona si `landing/` es el document root** (no un subdirectorio).

---

## 1. Qué se sirve

Estructura publicada (raíz = `landing/`):

```
/                      → index.html            (home)
/about-us/             → about-us/index.html
/faqs/                 → faqs/index.html
/tatuadores/           → tatuadores/index.html (landing beta existente — no tocar)
/shared/               → css, js, fonts, vendor (gsap, supabase.min.js)
/assets/               → imágenes (tatuadores/, aliados/, site/)
/robots.txt
/sitemap.xml
```

Es un sitio 100% estático: **no hay build step, no hay Node en el servidor**. El único tráfico dinámico es el waitlist, que va directo del navegador a Supabase (`https://flbgmlvfiejfttlawnfu.supabase.co`).

### Subida por rsync

```bash
# Desde la raíz del repo (excluir metadatos que no deben publicarse):
rsync -avz --delete \
  --exclude '.claude/' \
  --exclude 'DEPLOY-WEOTZI.md' \
  landing/ usuario@servidor:/var/www/weotzi.com/
```

`--delete` mantiene el servidor idéntico al repo (borra lo que ya no exista localmente). Verifica que `/var/www/weotzi.com/index.html` exista tras el primer sync.

---

## 2. Configuración nginx (recomendada)

### 2.1 Snippet de headers de seguridad

nginx tiene una trampa conocida: un `add_header` dentro de un `location` **anula todos** los `add_header` heredados del `server`. Por eso los headers viven en un snippet que se incluye en cada bloque que declare sus propios `add_header`.

Crear `/etc/nginx/snippets/weotzi-security.conf`:

```nginx
# --- Headers de seguridad We Otzi ---
# HSTS: DESACTIVADO por defecto. Descomentar SOLO cuando el certificado TLS esté
# confirmado y estable tras el switch (si TLS falla con HSTS activo, los
# navegadores que ya visitaron bloquean el dominio hasta que expire el max-age).
# Empezar con un max-age bajo (86400 = 1 día) y subir a 31536000 tras unos días en verde:
# add_header Strict-Transport-Security "max-age=86400; includeSubDomains" always;

add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Permissions-Policy mínima: el sitio no usa cámara, micrófono, geolocalización ni pagos.
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;

# Content-Security-Policy REAL de este sitio (ver notas abajo):
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self' https://flbgmlvfiejfttlawnfu.supabase.co; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests" always;
```

**Notas sobre la CSP (por qué cada directiva es así):**

- `script-src 'self'` — todo el JS del sitio son archivos propios (`/shared/js/*.js`, `/shared/vendor/*.js`). **Sin `'unsafe-eval'` y sin `'unsafe-inline'`**: cualquier `<script>` inline en el HTML será bloqueado; si algún día hace falta un script, debe ir como archivo externo en `/shared/js/`.
- `style-src 'self' 'unsafe-inline'` — el sitio usa **estilos inline en atributos** (`style="..."` en el HTML, y JS que setea `element.style`). La CSP no permite autorizar atributos `style` con hashes ni nonces (solo aplican a elementos `<style>`), y `'unsafe-hashes'` tiene soporte inconsistente entre navegadores, así que `'unsafe-inline'` es necesario **solo aquí**. El riesgo es bajo: inyectar estilos no ejecuta código.
- `img-src 'self' data:` — `data:` es necesario porque `landing.css` usa una textura de ruido como SVG embebido en `data:` URI (`background-image: url("data:image/svg+xml,...")`).
- `connect-src ... https://flbgmlvfiejfttlawnfu.supabase.co` — el formulario de waitlist (`/shared/js/waitlist.js`) escribe en la tabla `beta_waitlist` de Supabase vía fetch del cliente `supabase.min.js` (servido localmente desde `/shared/vendor/`).
- `frame-src https://www.youtube-nocookie.com` — para el embed de YouTube (pendiente: se activa cuando se setee `data-yt-id` en la home). Se usa el dominio *nocookie* a propósito.
- `media-src 'self'` — el video promocional se servirá desde `/assets/site/promo.mp4` (pendiente de subir).
- `frame-ancestors 'none'` — equivalente moderno de `X-Frame-Options: DENY` (se mandan ambos por compatibilidad).
- No hay Google Fonts ni CDNs: las fuentes son woff2 locales (`font-src 'self'`).

### 2.2 Server blocks

`/etc/nginx/sites-available/weotzi.com`:

```nginx
# ---------- HTTP → HTTPS ----------
server {
    listen 80;
    listen [::]:80;
    server_name weotzi.com www.weotzi.com;

    # Dejar pasar el challenge de certbot si se usa webroot:
    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    location / { return 301 https://weotzi.com$request_uri; }
}

# ---------- www → apex ----------
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name www.weotzi.com;

    ssl_certificate     /etc/letsencrypt/live/weotzi.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/weotzi.com/privkey.pem;

    return 301 https://weotzi.com$request_uri;
}

# ---------- Sitio principal ----------
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name weotzi.com;

    root  /var/www/weotzi.com;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/weotzi.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/weotzi.com/privkey.pem;
    # (certbot suele añadir options-ssl-nginx.conf con protocolos/ciphers modernos)

    include snippets/weotzi-security.conf;

    # ----- Compresión -----
    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_min_length 512;
    gzip_types text/css application/javascript application/json
               image/svg+xml application/xml text/plain text/xml;

    # Brotli (mejor ratio) — requiere el módulo ngx_brotli
    # (paquete libnginx-mod-http-brotli-* en Debian/Ubuntu). Descomentar si está:
    # brotli on;
    # brotli_comp_level 6;
    # brotli_types text/css application/javascript application/json
    #              image/svg+xml application/xml text/plain text/xml;

    # ----- Redirects 301 del WordPress viejo -----
    # /?page_id=123 → /  (URLs "feas" de WP)
    if ($arg_page_id != "") { return 301 https://weotzi.com/; }

    # /contact-us/ → home con el formulario de beta.
    # OJO: la URL va entre comillas porque '#' sin comillas es comentario en nginx.
    location = /contact-us  { return 301 "https://weotzi.com/#beta"; }
    location = /contact-us/ { return 301 "https://weotzi.com/#beta"; }

    # Portafolios del WP → home
    location ^~ /portfolio_group { return 301 https://weotzi.com/; }
    location ^~ /portfolio       { return 301 https://weotzi.com/; }

    # Conservadas (mismas URLs que en WP): /about-us/ y /faqs/
    # → las sirve try_files sin redirect.

    # ----- Cache: assets estáticos, 1 año e immutable -----
    # NOTA (hash-note): los nombres de archivo NO llevan hash de contenido.
    # "immutable + 1 año" solo es seguro si, al cambiar un asset, se le cambia
    # el nombre (p. ej. hero-v2.webp) o se versiona la referencia en el HTML
    # (p. ej. /shared/js/site.js?v=2). Si se pisa un archivo con el mismo
    # nombre, los navegadores NO verán el cambio hasta dentro de un año.
    location ~* \.(css|js|woff2|webp|png|jpg|jpeg|gif|svg|ico|mp4|webm)$ {
        include snippets/weotzi-security.conf;  # re-incluir: add_header local anula los del server
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # robots.txt y sitemap.xml: cache corto para poder corregirlos rápido
    location ~* ^/(robots\.txt|sitemap\.xml)$ {
        include snippets/weotzi-security.conf;
        add_header Cache-Control "public, max-age=3600";
        try_files $uri =404;
    }

    # ----- HTML: nunca cachear (el HTML es el "puntero" a los assets versionados) -----
    location / {
        include snippets/weotzi-security.conf;
        add_header Cache-Control "no-cache, must-revalidate";
        try_files $uri $uri/ =404;
    }
}
```

Activar y recargar:

```bash
sudo ln -s /etc/nginx/sites-available/weotzi.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 3. Variante Apache (.htaccess) — hosting compartido

Si weotzi.com sigue en el hosting compartido del WordPress, subir el contenido de `landing/` al document root (normalmente `public_html/`) y este `.htaccess` en la raíz:

```apache
# ---------- HTTPS forzado ----------
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://weotzi.com%{REQUEST_URI} [R=301,L]

# www → apex
RewriteCond %{HTTP_HOST} ^www\.weotzi\.com$ [NC]
RewriteRule ^ https://weotzi.com%{REQUEST_URI} [R=301,L]

# ---------- Redirects 301 del WordPress viejo ----------
# /?page_id=* → /   (el "?" final descarta el query string)
RewriteCond %{QUERY_STRING} (^|&)page_id= [NC]
RewriteRule ^$ https://weotzi.com/? [R=301,L]

# /contact-us/ → /#beta
RewriteRule ^contact-us/?$ https://weotzi.com/#beta [R=301,L,NE]

# /portfolio_group/* y /portfolio/* → /
RewriteRule ^portfolio_group(/.*)?$ https://weotzi.com/ [R=301,L]
RewriteRule ^portfolio(/.*)?$ https://weotzi.com/ [R=301,L]

# ---------- Headers de seguridad ----------
<IfModule mod_headers.c>
    # HSTS: DESACTIVADO por defecto. Descomentar solo con TLS confirmado y estable;
    # empezar con max-age bajo (86400) y subir a 31536000 tras unos días en verde.
    # Header always set Strict-Transport-Security "max-age=86400; includeSubDomains"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self' https://flbgmlvfiejfttlawnfu.supabase.co; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"

    # HTML sin cache
    <FilesMatch "\.html$">
        Header set Cache-Control "no-cache, must-revalidate"
    </FilesMatch>
    # Assets 1 año immutable (misma advertencia: renombrar el archivo al cambiarlo)
    <FilesMatch "\.(css|js|woff2|webp|png|jpe?g|gif|svg|ico|mp4|webm)$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
</IfModule>

# ---------- Compresión ----------
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml
    AddOutputFilterByType DEFLATE application/javascript application/json image/svg+xml
</IfModule>
<IfModule mod_brotli.c>
    AddOutputFilterByType BROTLI_COMPRESS text/html text/css text/plain text/xml
    AddOutputFilterByType BROTLI_COMPRESS application/javascript application/json image/svg+xml
</IfModule>

# Sin listado de directorios
Options -Indexes
```

Apache sirve `index.html` en directorios por defecto (`DirectoryIndex`), así que `/about-us/` y `/faqs/` funcionan sin reglas extra.

---

## 4. Checklist de lanzamiento

**Antes del switch**

- [ ] `rsync` del contenido de `landing/` al servidor (o subir por FTP en hosting compartido).
- [ ] Certificado TLS emitido para `weotzi.com` y `www.weotzi.com` (certbot / panel del hosting).
- [ ] `nginx -t` en verde (o `.htaccess` subido sin error 500).

**Switch de DNS/hosting**

- [ ] Apuntar el registro A/AAAA de `weotzi.com` (y `www`) al nuevo servidor, o cambiar el document root en el hosting actual. TTL bajo (300s) unas horas antes ayuda.

**Verificación funcional**

- [ ] `https://weotzi.com/`, `/about-us/`, `/faqs/`, `/tatuadores/` responden 200 con el contenido nuevo.
- [ ] `http://weotzi.com/` y `https://www.weotzi.com/` → 301 a `https://weotzi.com/`.
- [ ] Redirects viejos: `/contact-us/` → `/#beta`; `/portfolio/loquesea` → `/`; `/?page_id=2` → `/`.
- [ ] El formulario de waitlist inserta en `beta_waitlist` (probar con un correo y con un `@instagram`; un duplicado debe mostrarse como éxito).
- [ ] Consola del navegador sin errores de CSP en todas las páginas (si aparece uno, revisar la sección CSP arriba antes de relajar nada).
- [ ] `https://weotzi.com/robots.txt` y `https://weotzi.com/sitemap.xml` responden 200.
- [ ] Headers: verificar con `curl -sI https://weotzi.com/` (CSP, etc.) o https://securityheaders.com.
- [ ] Con TLS estable unos días: descomentar HSTS (empezar con `max-age=86400`, luego subir a `31536000`).

**SEO**

- [ ] Google Search Console: verificar la propiedad `weotzi.com` (si el WP ya estaba verificado, se conserva) y **enviar `https://weotzi.com/sitemap.xml`**.
- [ ] Pedir inspección/indexación de la home en GSC.
- [ ] Verificar Open Graph con un debugger (https://developers.facebook.com/tools/debug/ y https://cards-dev.twitter.com/validator): canonical y `og:image` deben ser URLs absolutas `https://weotzi.com/...`.

**Limpieza del WordPress (importante — seguridad)**

- [ ] Descargar un backup final del WP (export de contenido) y guardarlo **fuera** del servidor.
- [ ] Borrar por completo la instalación de WordPress del servidor: core, `wp-content/`, y sobre todo `wp-config.php` (contiene credenciales de base de datos).
- [ ] Borrar backups viejos del WP que queden en el servidor (`*.sql`, `*.zip`, carpetas `backup*/`): suelen contener credenciales y son un vector clásico de fuga.
- [ ] Eliminar la base de datos MySQL del WP y su usuario.
- [ ] Revocar/desinstalar plugins con acceso externo (Jetpack, plugins de SMTP con API keys, page builders con cuentas) y revocar sus API keys en los servicios correspondientes.
- [ ] Cancelar cron jobs / tareas del panel asociadas al WP.

---

## 5. Pendientes del usuario (post-lanzamiento)

1. **Video promocional**: subir el archivo final a `/assets/site/promo.mp4`. El componente de la home ya está cableado y se activa solo cuando el archivo exista (mientras tanto muestra el estado "Muy pronto" con el póster `/assets/site/promo-poster.webp`).
2. **Video de YouTube**: cuando exista, setear `data-yt-id` en el componente correspondiente de la home. El embed usa `youtube-nocookie.com` (ya permitido en la CSP).
3. **Email público de contacto**: hoy el único contacto es Instagram (@weotzi) + el formulario de beta. Cuando haya un email público, añadirlo al footer y a los datos estructurados.
4. **og:image dedicadas**: hoy la home usa la provisional `/assets/site/og-home.webp` y tatuadores `/assets/tatuadores/og.webp`. Generar imágenes OG específicas por página (1200×630).
5. **Regenerar imágenes con Higgsfield** cuando el conector esté disponible (hero, texturas y og definitivas).

---

*Última actualización: 2026-07-02.*
