# QR Code Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un botón QR en la fila de botones sociales del dashboard del artista que abre un modal con el código QR del perfil o galería, con descarga PNG/SVG, copiar URL y compartir.

**Architecture:** Un botón ícono QR se añade a la fila social existente del bloque de identidad. Al hacer clic abre un modal overlay (mismo patrón que `#password-modal` y `#ai-avatar-modal`). El QR se genera con la librería `qrcode@1.5.3` via jsDelivr CDN. Dos variables de módulo globales (`currentQRUrl`, `currentQRDest`) mantienen el estado del QR activo. Las funciones llamadas desde atributos `onclick` en el HTML deben exponerse como `window.fn = fn` siguiendo el patrón establecido en el archivo (ver líneas 2501–2505 de `dashboard.js`).

**Tech Stack:** HTML/CSS/JS vanilla, qrcode@1.5.3 (jsDelivr CDN), Canvas API, Blob API, Web Share API, Clipboard API

**Spec:** `docs/superpowers/specs/2026-03-25-qr-code-dashboard-design.md`

---

## File Map

| Archivo | Tipo | Cambio |
|---------|------|--------|
| `public/artist/dashboard/index.html` | Modificar | +script CDN en `<head>`, +botón QR en fila social, +modal QR antes de los scripts |
| `public/shared/js/dashboard.js` | Modificar | +2 variables globales tras línea 24, +llamada en setupEventListeners antes del cierre de la función, +8 funciones + 7 exports `window.*` al final del archivo |
| `public/shared/css/dashboard.css` | Modificar | +sección QR MODAL STYLES después de la sección PASSWORD MODAL STYLES |

---

### Task 1: Agregar CDN de qrcode y botón QR en el HTML

**Archivos:**
- Modificar: `public/artist/dashboard/index.html` — `<head>` (CDN) y fila social (botón)

- [ ] **Step 1: Agregar el script CDN de qrcode en `<head>`**

En `public/artist/dashboard/index.html`, localizar la línea que contiene `browser-image-compression`:

```html
    <script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
```

Insertar la línea siguiente **después** de ella:

```html
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
```

La siguiente línea después del CDN de qrcode debe ser `<script src="/shared/js/config-manager.js">`.

- [ ] **Step 2: Agregar el botón QR en la fila de botones sociales**

En `public/artist/dashboard/index.html`, localizar el botón `#share-profile-btn` que termina con:

```html
                </button>
            </div>
```

El `</button>` que cierra `#share-profile-btn` está justo antes del `</div>` que cierra `.artist-social-links`. Insertar el botón QR **entre** ese `</button>` y el `</div>`:

```html
                <button type="button" id="qr-profile-btn" class="social-link-btn" onclick="openQRModal()" aria-label="Generar código QR">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                        <rect x="5" y="5" width="3" height="3" fill="currentColor"/>
                        <rect x="16" y="5" width="3" height="3" fill="currentColor"/>
                        <rect x="5" y="16" width="3" height="3" fill="currentColor"/>
                        <rect x="14" y="14" width="2" height="2" fill="currentColor"/>
                        <rect x="17" y="14" width="2" height="2" fill="currentColor"/>
                        <rect x="20" y="14" width="2" height="2" fill="currentColor"/>
                        <rect x="14" y="17" width="2" height="2" fill="currentColor"/>
                        <rect x="20" y="20" width="2" height="2" fill="currentColor"/>
                    </svg>
                </button>
```

- [ ] **Step 3: Verificar en el navegador que el botón aparece**

Abrir el dashboard con una sesión de artista activa. Verificar que:
- El botón QR aparece en la fila social junto a WhatsApp, Instagram y Compartir
- El tamaño es consistente con los otros botones sociales (hereda `.social-link-btn`)
- Al hacer clic aparece `ReferenceError: openQRModal is not defined` en consola — **esto es esperado** porque el JS aún no está implementado

- [ ] **Step 4: Commit**

```bash
git add "public/artist/dashboard/index.html"
git commit -m "feat: add QR button to artist dashboard social row and qrcode CDN"
```

---

### Task 2: Agregar el modal QR en el HTML

**Archivos:**
- Modificar: `public/artist/dashboard/index.html` — insertar modal antes de los scripts

- [ ] **Step 1: Insertar el modal QR antes de los scripts**

En `public/artist/dashboard/index.html`, localizar la línea:

```html
    <script src="/shared/js/bio-formatting.js"></script>
```

Insertar el bloque del modal **directamente antes** de esa línea:

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

- [ ] **Step 2: Verificar que el modal existe en el DOM**

En DevTools del navegador, ejecutar:
```js
document.getElementById('qr-modal')        // debe retornar el div
document.querySelectorAll('.qr-tab').length // debe retornar 2
```

Para ver el modal visualmente (sin JS completo aún), ejecutar:
```js
document.getElementById('qr-modal').classList.add('active')
```
Verificar que el overlay aparece. Cerrar con:
```js
document.getElementById('qr-modal').classList.remove('active')
```

- [ ] **Step 3: Commit**

```bash
git add "public/artist/dashboard/index.html"
git commit -m "feat: add QR modal HTML structure to artist dashboard"
```

---

### Task 3: Agregar estilos CSS del modal QR

**Archivos:**
- Modificar: `public/shared/css/dashboard.css` — agregar sección después de PASSWORD MODAL STYLES

- [ ] **Step 1: Agregar sección QR MODAL STYLES en dashboard.css**

En `public/shared/css/dashboard.css`, localizar el bloque de PASSWORD MODAL STYLES:

```css
/* ============================================
   PASSWORD MODAL STYLES
   Uses existing modal styles from style.css
   ============================================ */

#password-modal .modal-container {
    max-width: 420px;
}

#password-message {
    min-height: 1.2rem;
}
```

Insertar el siguiente bloque **después** del cierre `}` de `#password-message`:

```css

/* ============================================
   QR MODAL STYLES
   ============================================ */

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
    /* color-mix es compatible con Chrome 111+, Firefox 113+, Safari 16.2+ */
    background: color-mix(in srgb, var(--fg) 10%, transparent);
}

.qr-tab.active {
    background: var(--fg);
    color: var(--bg);
}

.qr-canvas-wrapper {
    border: var(--border-width) solid var(--fg);
    padding: 1rem;
    background: #ffffff; /* Forzado blanco — el QR requiere contraste claro/oscuro */
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
        padding: 0.5rem;
    }
}
```

- [ ] **Step 2: Verificar el modal visualmente**

Abrir el dashboard en el navegador. En consola:
```js
document.getElementById('qr-modal').classList.add('active')
```
Verificar que:
- El modal se centra con overlay semitransparente
- Título "QR DE PERFIL" en mayúsculas monospace
- Dos tabs "PERFIL" / "GALERÍA" con separación vertical
- Área canvas tiene fondo blanco con borde
- Botones en grid: PNG (full-width), SVG + Copiar URL, Compartir (oculto)

- [ ] **Step 3: Verificar en dark mode**

Activar dark mode (botón "Ö" en el header). Abrir el modal. Verificar que:
- El modal adapta colores al tema oscuro
- El área del canvas **sigue siendo blanca** (fondo forzado)
- Hover en tab inactivo muestra color claro semitransparente

- [ ] **Step 4: Commit**

```bash
git add "public/shared/css/dashboard.css"
git commit -m "feat: add QR modal CSS styles to dashboard"
```

---

### Task 4: Agregar variables globales y funciones JS

**Archivos:**
- Modificar: `public/shared/js/dashboard.js` — 3 puntos de inserción

- [ ] **Step 1: Agregar variables de módulo globales**

En `public/shared/js/dashboard.js`, localizar el bloque de variables de módulo que termina con:

```js
let placesAutocompleteDashboard = null;
```

Insertar las dos variables **después** de esa línea:

```js
let currentQRUrl = '';         // URL actualmente mostrada en el modal QR
let currentQRDest = 'profile'; // Destino activo del QR: 'profile' | 'gallery'
```

- [ ] **Step 2: Agregar llamada a setupQRTabListeners en setupEventListeners**

En `public/shared/js/dashboard.js`, localizar el bloque al final de `setupEventListeners()`:

```js
    // Gallery edit input
    const galleryEditInput = document.getElementById('gallery-edit-input');
    if (galleryEditInput) {
        galleryEditInput.addEventListener('change', handleGalleryEditUpload);
    }
}
```

El `}` final cierra `setupEventListeners`. Insertar **antes** de ese `}` de cierre:

```js

    // QR Modal tabs
    setupQRTabListeners();
```

La función debe quedar así al final:

```js
    // Gallery edit input
    const galleryEditInput = document.getElementById('gallery-edit-input');
    if (galleryEditInput) {
        galleryEditInput.addEventListener('change', handleGalleryEditUpload);
    }

    // QR Modal tabs
    setupQRTabListeners();
}
```

- [ ] **Step 3: Agregar las funciones QR y exports window.* al final del archivo**

En `public/shared/js/dashboard.js`, localizar las últimas líneas del archivo (actualmente son los exports de estilos):

```js
window.openStylesModal = openStylesModal;
window.closeStylesModal = closeStylesModal;
window.closeStylesModalOnOverlay = closeStylesModalOnOverlay;
window.confirmStylesSelection = confirmStylesSelection;
window.addDashboardCustomStyle = addDashboardCustomStyle;
```

Agregar **después** de esas líneas el siguiente bloque completo:

```js

// ============================================
// QR CODE MODAL
// ============================================

function openQRModal() {
    if (typeof QRCode === 'undefined') {
        showStatusMessage('Error al cargar el generador de QR. Recarga la página.', 'error');
        return;
    }
    if (!artistData?.username) {
        showStatusMessage('Completa tu perfil para generar el QR.', 'error');
        return;
    }

    // Mostrar botón Compartir solo si la API está disponible
    const shareBtn = document.getElementById('qr-share-btn');
    if (shareBtn) {
        shareBtn.style.display = ('share' in navigator) ? '' : 'none';
    }

    // Resetear tabs al estado inicial (PERFIL activo)
    document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
    const profileTab = document.querySelector('.qr-tab[data-dest="profile"]');
    if (profileTab) profileTab.classList.add('active');
    currentQRDest = 'profile';

    generateQR('profile');

    document.getElementById('qr-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeQRModal() {
    document.getElementById('qr-modal').classList.remove('active');
    document.body.style.overflow = '';
}

function closeQRModalOnOverlay(e) {
    if (e.target.id === 'qr-modal') {
        closeQRModal();
    }
}

function generateQR(dest) {
    const username = artistData.username; // garantizado truthy por openQRModal
    const origin = window.location.origin;
    const encodedUsername = encodeURIComponent(username);

    const url = dest === 'gallery'
        ? `${origin}/artist/profile?artist=${encodedUsername}#gallery`
        : `${origin}/artist/profile?artist=${encodedUsername}`;

    currentQRUrl = url;
    currentQRDest = dest;

    const urlDisplay = document.getElementById('qr-url-display');
    if (urlDisplay) urlDisplay.textContent = url;

    const canvas = document.getElementById('qr-canvas');
    QRCode.toCanvas(canvas, url, {
        width: 240,
        margin: 2,
        color: { dark: '#1a1a1a', light: '#ffffff' }
    }, (err) => {
        if (err) showStatusMessage('Error generando el QR.', 'error');
    });
}

function setupQRTabListeners() {
    document.querySelectorAll('.qr-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.qr-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            generateQR(tab.dataset.dest);
        });
    });
}

function downloadQRPNG() {
    const canvas = document.getElementById('qr-canvas');
    const dataUrl = canvas.toDataURL('image/png');
    const username = artistData?.username || 'perfil';
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${username}-${currentQRDest}.png`;
    a.click();
}

function downloadQRSVG() {
    const username = artistData?.username || 'perfil';
    QRCode.toString(currentQRUrl, {
        type: 'svg',
        margin: 2,
        color: { dark: '#1a1a1a', light: '#ffffff' }
    }, (err, svgString) => {
        if (err) {
            showStatusMessage('Error generando el SVG.', 'error');
            return;
        }
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qr-${username}-${currentQRDest}.svg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

function copyQRUrl() {
    const btn = document.getElementById('qr-copy-btn');
    const resetBtn = () => { if (btn) btn.textContent = '⎘ Copiar URL'; };

    if (navigator.clipboard) {
        navigator.clipboard.writeText(currentQRUrl)
            .then(() => {
                if (btn) btn.textContent = '✓ Copiado';
                setTimeout(resetBtn, 2000);
            })
            .catch(() => showStatusMessage('No se pudo copiar la URL.', 'error'));
    } else {
        // Fallback para WebViews sin Clipboard API
        const input = document.createElement('input');
        input.value = currentQRUrl;
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(input);
        input.select();
        try {
            document.execCommand('copy');
            if (btn) btn.textContent = '✓ Copiado';
            setTimeout(resetBtn, 2000);
        } catch (e) {
            showStatusMessage('No se pudo copiar la URL.', 'error');
        }
        document.body.removeChild(input);
    }
}

function shareQRUrl() {
    if (!('share' in navigator)) return;
    const username = artistData?.username || 'artista';
    navigator.share({
        title: `${username} — We Otzi`,
        url: currentQRUrl
    }).catch(() => {}); // El usuario puede cancelar el share — silencioso
}

// Exponer funciones llamadas desde onclick en el HTML
window.openQRModal = openQRModal;
window.closeQRModal = closeQRModal;
window.closeQRModalOnOverlay = closeQRModalOnOverlay;
window.downloadQRPNG = downloadQRPNG;
window.downloadQRSVG = downloadQRSVG;
window.copyQRUrl = copyQRUrl;
window.shareQRUrl = shareQRUrl;
```

- [ ] **Step 4: Verificar funcionamiento end-to-end**

Con el dashboard abierto y sesión de artista activa:

1. Hacer clic en el botón QR (ícono cuadrado en la fila social)
2. Verificar que el modal se abre con el QR generado visible
3. Verificar que la URL debajo del QR contiene el username del artista
4. Cambiar al tab "GALERÍA" — el QR debe regenerarse y la URL tener `#gallery`
5. Volver al tab "PERFIL" — el QR vuelve a la URL sin fragmento
6. Hacer clic en "↓ Descargar PNG" — debe descargarse un archivo `.png` con el nombre `qr-{username}-profile.png`
7. Hacer clic en "↓ Descargar SVG" — debe descargarse un archivo `.svg`
8. Hacer clic en "⎘ Copiar URL" — el botón debe cambiar a "✓ Copiado" por 2 segundos
9. Hacer clic en el overlay (fuera del modal) — el modal se cierra
10. Abrir de nuevo y hacer clic en el botón X — el modal se cierra

- [ ] **Step 5: Verificar edge case — username vacío**

En la consola del navegador, simular artista sin username:
```js
const saved = artistData.username;
artistData.username = null;
openQRModal(); // Debe mostrar toast de error, NO abrir el modal
artistData.username = saved; // Restaurar
openQRModal(); // Ahora sí debe abrir normalmente
```

- [ ] **Step 6: Commit**

```bash
git add "public/shared/js/dashboard.js"
git commit -m "feat: add QR code modal JS — open/close, generate, download PNG/SVG, copy, share"
```

---

### Task 5: Limpiar archivo temporal del mockup

**Archivos:**
- Eliminar: `tmp_qr_mockup.html` (archivo no trackeado por git — usar `rm`, no `git rm`)

- [ ] **Step 1: Eliminar el archivo de mockup**

```bash
rm "tmp_qr_mockup.html"
```

No requiere commit porque el archivo nunca fue trackeado por git (`??` en git status).

---

### Task 6: Verificación final de compatibilidad

- [ ] **Step 1: Verificar en dark mode completo**

Activar dark mode, abrir el modal QR. Verificar:
- El overlay y el container usan colores oscuros
- Los tabs invierten correctamente (activo: fondo claro, texto oscuro)
- El canvas QR **siempre** tiene fondo blanco independiente del tema
- Hover en botones de acción invierte correctamente

- [ ] **Step 2: Verificar en mobile (viewport 375px)**

En DevTools → viewport iPhone SE (375×667). Verificar:
- El modal no desborda horizontalmente
- El canvas de 240px cabe dentro del modal con padding
- Los botones tienen altura suficiente para toque (mín 44px)
- El tab "GALERÍA" no se trunca

- [ ] **Step 3: Verificar que no hay regresiones en otros modales**

- Modal de cambio de contraseña (`#password-modal`): abrir, usar, cerrar — debe funcionar normal
- Modal de avatar IA (`#ai-avatar-modal`): abrir, cerrar — debe funcionar normal
- Verificar en consola que no hay errores JavaScript al cargar la página

- [ ] **Step 4: Verificar historial de commits**

```bash
git log --oneline -6
```

Debe mostrar los 4 commits de la feature:
```
feat: add QR code modal JS — open/close, generate, download PNG/SVG, copy, share
feat: add QR modal CSS styles to dashboard
feat: add QR modal HTML structure to artist dashboard
feat: add QR button to artist dashboard social row and qrcode CDN
```

---

## Resumen de cambios

| Archivo | Líneas añadidas (aprox.) | Tipo de cambio |
|---------|--------------------------|----------------|
| `public/artist/dashboard/index.html` | ~38 | +CDN script, +botón QR, +modal HTML |
| `public/shared/js/dashboard.js` | ~145 | +2 variables, +llamada en setup, +8 funciones, +7 exports window.* |
| `public/shared/css/dashboard.css` | ~105 | +sección QR MODAL STYLES con responsive |

**Sin archivos nuevos. Sin cambios en lógica de autenticación, perfil, milestones ni grid del dashboard.**
