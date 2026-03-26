# Deploy: Generador de código QR en el dashboard del artista

**Fecha:** 2026-03-25
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Se agregó un generador de código QR al dashboard del artista. Un botón ícono QR aparece en la fila de botones sociales del bloque de identidad. Al hacer clic abre un modal que genera el QR del perfil público o de la galería del artista, con opciones de descarga en PNG y SVG, copiar URL y compartir nativo en móvil.

Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

### Funcionalidad nueva

1. **Botón QR en la fila social** — Ícono QR junto a WhatsApp, Instagram y Compartir en el bloque de identidad del dashboard. Mismo tamaño y estilo que los botones existentes.

2. **Modal QR** — Se abre al hacer clic en el botón. Contiene:
   - Selector de destino (tabs): **PERFIL** → `https://beta.weotzi.com/artist/profile?artist={username}` / **GALERÍA** → misma URL con `#gallery`
   - Canvas con el QR generado (240×240px, fondo blanco forzado para legibilidad en lectores físicos)
   - URL del QR mostrada en micro-texto debajo del canvas
   - Botón **Descargar PNG** — descarga el QR como imagen PNG
   - Botones **Descargar SVG** + **Copiar URL** — SVG vectorial para imprimir, clipboard con fallback para WebViews
   - Botón **Compartir** — visible solo en dispositivos con `navigator.share` (iOS Safari, Android Chrome)

3. **Compatibilidad** — Cierra con tecla Escape (consistente con otros modales), adapta colores a dark mode, responsive en mobile (375px+).

### Librería agregada

CDN en el `<head>` del HTML:
```
https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js
```
Cargada desde jsDelivr — no requiere instalación en el servidor.

---

## Archivos a subir

```
public/artist/dashboard/index.html
public/shared/js/dashboard.js
public/shared/css/dashboard.css
```

---

## Comando

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/artist/dashboard/index.html \
  public/shared/js/dashboard.js \
  public/shared/css/dashboard.css
```

Sin `--restart`. PM2 no necesita reiniciarse.

---

## Verificación

Probar en `https://beta.weotzi.com/artist/dashboard/` con una cuenta de artista:

1. En el bloque de identidad (foto, nombre, botones sociales), verificar que aparece un **ícono QR** nuevo junto al botón de compartir.

2. Hacer clic en el ícono QR → debe abrirse el modal **"QR DE PERFIL"** con:
   - Dos tabs: PERFIL y GALERÍA
   - Un QR visible en el canvas (patrón de cuadrados negro sobre fondo blanco)
   - La URL del perfil en micro-texto debajo del QR

3. **Tab GALERÍA:** Hacer clic en el tab GALERÍA → el QR debe regenerarse y la URL mostrada debe incluir `#gallery` al final.

4. **Descargar PNG:** Hacer clic en "↓ Descargar PNG" → debe descargarse un archivo `qr-{username}-profile.png` o `qr-{username}-gallery.png`.

5. **Descargar SVG:** Hacer clic en "↓ Descargar SVG" → debe descargarse un archivo `.svg`. Abrirlo en el navegador confirma que es un QR vectorial legible.

6. **Copiar URL:** Hacer clic en "⎘ Copiar URL" → el botón debe cambiar a "✓ Copiado" por 2 segundos. Pegar el portapapeles confirma que es la URL correcta del perfil.

7. **Cerrar con Escape:** Con el modal abierto, presionar la tecla Escape → el modal debe cerrarse.

8. **Cerrar con overlay:** Con el modal abierto, hacer clic fuera del modal (en el área oscura) → el modal debe cerrarse.

9. **Dark mode:** Activar dark mode (botón "Ö" en el header) y abrir el modal QR → el modal debe usar colores oscuros pero el área del canvas QR debe seguir siendo blanca.

10. **Edge case — perfil incompleto:** Temporalmente, desde la consola del navegador:
    ```js
    const s = artistData.username; artistData.username = null;
    openQRModal();
    artistData.username = s;
    ```
    Debe mostrar el toast de error "Completa tu perfil para generar el QR." sin abrir el modal.

### Prueba en móvil

Desde iPhone (Safari) o Android (Chrome):
- Abrir el dashboard y hacer clic en el botón QR
- Verificar que aparece el botón "↗ Compartir" en el modal
- Hacer clic en Compartir → debe abrirse el sheet nativo de compartir del sistema operativo con la URL del perfil
