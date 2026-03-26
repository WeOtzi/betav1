# Spec: Generador de Código QR en el Dashboard del Artista

**Fecha:** 2026-03-25
**Estado:** Aprobado
**Archivos afectados:** `public/artist/dashboard/index.html`, `public/shared/js/dashboard.js`, `public/shared/css/dashboard.css`

---

## Contexto

El dashboard del artista ya cuenta con botones sociales (WhatsApp, Instagram, Compartir perfil) en el bloque de identidad. Los artistas necesitan compartir su perfil público de forma rápida en contextos offline (eventos, estudios, ferias de tatuajes), donde un código QR es más práctico que enviar un enlace por mensaje.

---

## Objetivo

Agregar un botón QR en la fila de botones sociales del bloque de identidad. Al hacer clic, abre un modal que muestra el código QR del perfil público o la sección de galería del artista, con opciones de descarga PNG, descarga SVG, copiar URL y compartir.

---

## Decisiones de diseño

### Patrón de UI: Modal overlay

Sigue el patrón existente en el dashboard:
- `.modal-overlay` + clase `.active` para mostrar/ocultar (definido en `landing-style.css`)
- `.modal-container` con borde `var(--border-width) solid var(--fg)` y fondo `var(--bg)`
- Botón `.modal-close` en esquina superior derecha con rotación en hover
- Click en overlay cierra el modal
- El modal se inserta al final del `<body>`, antes del cierre `</body>`, igual que `#password-modal` y `#ai-avatar-modal`

### Trigger: Ícono QR en la fila social

Botón `.social-link-btn` sin tamaño fijo propio — hereda el tamaño definido por `.social-link-btn` en `dashboard.css` (responsive: 40px desktop, 36px tablet, 32px mobile). Se inserta después del botón existente `#share-profile-btn`. Usa ícono SVG de QR. Al hacer clic llama `openQRModal()`.

### Librería QR: `qrcode@1.5.3`

Cargada desde jsDelivr CDN (misma CDN que Supabase, heic2any):

```html
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
```

Provee:
- `QRCode.toCanvas(canvas, url, options)` → para renderizado y descarga PNG
- `QRCode.toString(url, {type:'svg'}, callback)` → para descarga SVG vectorial

El QR siempre se renderiza con `color: { dark: '#1a1a1a', light: '#ffffff' }` independiente del tema del dashboard, para garantizar legibilidad por lectores físicos.

### Selector de destino (tabs)

Dos botones `.qr-tab` dentro de `.qr-destination-tabs` que regeneran el QR al cambiar:

| Tab | URL generada |
|-----|-------------|
| `PERFIL` | `` `${window.location.origin}/artist/profile?artist=${encodeURIComponent(username)}` `` |
| `GALERÍA` | `` `${window.location.origin}/artist/profile?artist=${encodeURIComponent(username)}#gallery` `` |

Nota: `encodeURIComponent` se aplica solo al username, antes de concatenar el fragmento `#gallery`.

El tab activo tiene clase `.active` → fondo `var(--fg)`, color `var(--bg)`. El inactivo: fondo transparente, color `var(--fg)`. Hover en tab inactivo: fondo `var(--fg)` opacidad 0.08 (igual al hover de tabs en el sistema existente).

### Acciones del modal

Grid 2 columnas, 4 botones:

| Botón | Estilo | Acción |
|-------|--------|--------|
| `↓ Descargar PNG` | Primario, `grid-column: 1 / -1` (full-width) | PNG via canvas |
| `↓ Descargar SVG` | Secundario | SVG via Blob |
| `⎘ Copiar URL` | Secundario | Clipboard |
| `↗ Compartir` | Secundario | `navigator.share()` con fallback |

Con 4 botones: primera fila = PNG (full-width), segunda fila = SVG + Copiar URL, tercera fila = Compartir (full-width si `navigator.share` disponible, oculto si no).

Alternativa más simple: fila 1 PNG full-width, fila 2 SVG + Copiar, fila 3 Compartir full-width solo si `'share' in navigator`. El botón Compartir se muestra/oculta en `openQRModal()` según disponibilidad.

---

## Estructura del modal (HTML)

Se agrega al final de `<body>` (antes de `</body>`), siguiendo el orden de `#password-modal` y `#ai-avatar-modal`:

```html
<!-- QR Code Modal -->
<div id="qr-modal" class="modal-overlay" onclick="closeQRModalOnOverlay(event)">
  <div class="modal-container qr-modal-container">
    <button class="modal-close" onclick="closeQRModal()" aria-label="Cerrar">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
    <h2 class="qr-modal-title">QR DE PERFIL</h2>
    <div class="qr-destination-tabs">
      <button class="qr-tab active" data-dest="profile">PERFIL</button>
      <button class="qr-tab" data-dest="gallery">GALERÍA</button>
    </div>
    <div class="qr-canvas-wrapper">
      <canvas id="qr-canvas"></canvas>
    </div>
    <p class="qr-url-display" id="qr-url-display"></p>
    <div class="qr-actions">
      <button class="qr-action-btn qr-action-primary" onclick="downloadQRPNG()">↓ Descargar PNG</button>
      <button class="qr-action-btn" onclick="downloadQRSVG()">↓ Descargar SVG</button>
      <button class="qr-action-btn" id="qr-copy-btn" onclick="copyQRUrl()">⎘ Copiar URL</button>
      <button class="qr-action-btn qr-action-share" id="qr-share-btn" onclick="shareQRUrl()" style="display:none">↗ Compartir</button>
    </div>
  </div>
</div>
```

---

## Variables JS a declarar

Al inicio de `dashboard.js`, junto a las otras variables de módulo globales (cerca de `let currentUser = null`):

```js
let currentQRUrl = '';      // URL actualmente mostrada en el QR
let currentQRDest = 'profile'; // Tab activo: 'profile' | 'gallery'
```

---

## Funciones JS a agregar

### `openQRModal()`

```
- Verifica que typeof QRCode !== 'undefined'; si no, muestra showStatusMessage('Error al cargar el generador de QR', 'error') y retorna
- Verifica que artistData?.username sea truthy; si no, muestra showStatusMessage('Completa tu perfil para generar el QR', 'error') y retorna
- Muestra/oculta #qr-share-btn según 'share' in navigator
- Resetea tab activo a 'profile' (remueve .active de todos los .qr-tab, agrega a [data-dest="profile"])
- currentQRDest = 'profile'
- Llama generateQR('profile')
- Agrega clase .active a #qr-modal
- document.body.style.overflow = 'hidden'
```

### `closeQRModal()`

```
- Remueve clase .active de #qr-modal
- document.body.style.overflow = ''
```

### `closeQRModalOnOverlay(e)`

```
- Si e.target.id === 'qr-modal' → llama closeQRModal()
```

### `generateQR(dest)`

```
- username = artistData.username (garantizado truthy por openQRModal)
- Construye URL:
  - dest === 'profile': `${window.location.origin}/artist/profile?artist=${encodeURIComponent(username)}`
  - dest === 'gallery': `${window.location.origin}/artist/profile?artist=${encodeURIComponent(username)}#gallery`
- currentQRUrl = URL construida
- currentQRDest = dest
- Actualiza #qr-url-display con el texto de currentQRUrl
- Llama QRCode.toCanvas(document.getElementById('qr-canvas'), currentQRUrl, { width: 240, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } })
- En caso de error del canvas: showStatusMessage('Error generando el QR', 'error')
```

### `setupQRTabListeners()`

```
- Se llama desde setupEventListeners() (existente)
- querySelectorAll('.qr-tab').forEach: en click, remueve .active de todos, agrega .active al clickeado, llama generateQR(tab.dataset.dest)
```

### `downloadQRPNG()`

```
- canvas = document.getElementById('qr-canvas')
- dataUrl = canvas.toDataURL('image/png')
- username = artistData?.username || 'perfil'
- Crea anchor temporal con href=dataUrl, download=`qr-${username}-${currentQRDest}.png`
- anchor.click(), luego URL.revokeObjectURL no aplica (es dataURL, no blob URL)
```

### `downloadQRSVG()`

```
- username = artistData?.username || 'perfil'
- QRCode.toString(currentQRUrl, { type: 'svg', margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } }, (err, svgString) => {
    if (err) { showStatusMessage('Error generando SVG', 'error'); return; }
    blob = new Blob([svgString], { type: 'image/svg+xml' })
    url = URL.createObjectURL(blob)
    anchor = document.createElement('a'), href=url, download=`qr-${username}-${currentQRDest}.svg`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
```

### `copyQRUrl()`

```
- Si navigator.clipboard disponible:
    navigator.clipboard.writeText(currentQRUrl).then(() => {
      btn = document.getElementById('qr-copy-btn')
      btn.textContent = '✓ Copiado'
      setTimeout(() => btn.textContent = '⎘ Copiar URL', 2000)
    }).catch(() => showStatusMessage('No se pudo copiar', 'error'))
- Si no (fallback execCommand):
    input temporal en DOM, input.value = currentQRUrl, input.select(), document.execCommand('copy'), remover input
    feedback igual al caso anterior
```

### `shareQRUrl()`

```
- Si !('share' in navigator): return (el botón ya está oculto)
- navigator.share({ title: `${artistData.username} — We Otzi`, url: currentQRUrl }).catch(() => {})
  (el rechazo por usuario que cancela es silencioso)
```

---

## CSS a agregar en `dashboard.css`

Bajo la sección existente `/* PASSWORD MODAL STYLES */`, agregar nueva sección `/* QR MODAL STYLES */`:

```css
/* QR MODAL STYLES */

#qr-modal .qr-modal-container {
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}

.qr-modal-title {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-align: center;
  margin: 0;
}

.qr-destination-tabs {
  display: flex;
  width: 100%;
  border: var(--border-width) solid var(--fg);
}

.qr-tab {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.5rem;
  background: transparent;
  color: var(--fg);
  border: none;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.qr-tab + .qr-tab {
  border-left: var(--border-width) solid var(--fg);
}

.qr-tab:hover:not(.active) {
  background: rgba(128, 128, 128, 0.1);
}

.qr-tab.active {
  background: var(--fg);
  color: var(--bg);
}

.qr-canvas-wrapper {
  border: var(--border-width) solid var(--fg);
  padding: 1rem;
  background: #ffffff; /* Forzado blanco para legibilidad del QR */
  line-height: 0; /* Elimina espacio extra bajo el canvas */
}

.qr-canvas-wrapper canvas {
  display: block;
}

.qr-url-display {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  line-height: 1.5;
  color: var(--fg);
  opacity: 0.5;
  text-align: center;
  word-break: break-all;
  margin: 0;
  max-width: 100%;
}

.qr-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  width: 100%;
}

.qr-action-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.6rem 0.75rem;
  border: var(--border-width) solid var(--fg);
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.qr-action-btn:hover {
  background: var(--fg);
  color: var(--bg);
}

.qr-action-primary,
.qr-action-share {
  grid-column: 1 / -1;
  background: var(--fg);
  color: var(--bg);
}

.qr-action-primary:hover,
.qr-action-share:hover {
  background: var(--primary-blue);
  border-color: var(--primary-blue);
  color: #ffffff;
}

/* Responsive */
@media (max-width: 480px) {
  #qr-modal .qr-modal-container {
    max-width: 95%;
    padding: 2rem 1.25rem;
  }
  .qr-modal-title {
    font-size: 0.75rem;
  }
  .qr-action-btn {
    font-size: 0.6rem;
    padding: 0.5rem 0.5rem;
  }
}
```

---

## Integración con código existente

### En `setupEventListeners()` (dashboard.js ~línea 447)

Agregar al final de la función:

```js
// QR Modal
setupQRTabListeners();
```

### En el HTML (fila social ~línea 158)

Insertar el botón QR después de `#share-profile-btn`:

```html
<button type="button" id="qr-profile-btn" class="social-link-btn" onclick="openQRModal()" aria-label="Generar código QR">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="3" width="7" height="7"/>
    <rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/>
    <rect x="5" y="5" width="3" height="3" fill="currentColor"/>
    <rect x="16" y="5" width="3" height="3" fill="currentColor"/>
    <rect x="5" y="16" width="3" height="3" fill="currentColor"/>
    <rect x="14" y="14" width="1" height="1" fill="currentColor"/>
    <rect x="17" y="14" width="1" height="1" fill="currentColor"/>
    <rect x="20" y="14" width="1" height="1" fill="currentColor"/>
    <rect x="14" y="17" width="1" height="1" fill="currentColor"/>
    <rect x="17" y="17" width="1" height="1" fill="currentColor"/>
    <rect x="20" y="20" width="1" height="1" fill="currentColor"/>
  </svg>
</button>
```

### Script CDN en `<head>` del HTML

Insertar junto a los otros scripts CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
```

---

## Compatibilidad

| Feature | Soporte |
|---------|---------|
| `QRCode.toCanvas` | Chrome, Firefox, Safari, Edge, iOS Safari 12+, Android Chrome |
| `canvas.toDataURL('image/png')` | Universal — todos los navegadores modernos |
| `Blob` + anchor download (SVG) | Chrome, Firefox, Safari 10.1+, Edge (IE11 no soportado — aceptable) |
| `navigator.clipboard.writeText` | HTTPS requerido (ya cumplido en producción); fallback `execCommand('copy')` para WebViews |
| `navigator.share` | iOS Safari 12+, Android Chrome 61+; botón se oculta si no disponible |

---

## Lo que NO cambia

- No se reorganiza el grid del dashboard
- No se modifica ningún bloque HTML existente más allá de insertar el botón en la fila social y el modal al final del body
- No se añaden dependencias npm (solo CDN)
- No se modifica la lógica de autenticación, perfil ni milestones
