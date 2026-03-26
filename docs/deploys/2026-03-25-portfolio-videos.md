# Deploy: Videos en Portfolio de Artistas

**Fecha:** 2026-03-25
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Se agregó soporte para subir y visualizar videos cortos (hasta 30 segundos) en la galería de trabajos del artista. Los artistas pueden subir hasta 2 videos MP4/MOV de un máximo de 80MB dentro de los 12 archivos totales del portfolio. La validación ocurre completamente en el cliente antes de subir. Todos los archivos modificados son estáticos — **no se requiere reiniciar PM2**.

### Cambios por archivo

1. **`dashboard.js`** — Validación de videos en cliente (tipo, conteo, tamaño, duración vía `loadedmetadata`), subida directa a Supabase sin pasar por `UploadQueue`, renderizado diferenciado de videos en la grilla admin (badge "VIDEO", overlay play), mensajes de error/éxito actualizados para ser genéricos ("archivo" en lugar de "imagen"), advertencia específica para archivos `.mov` sobre compatibilidad con Firefox. Aplica a los dos flujos de subida: bloque principal y modo edición.

2. **`artist-profile.js`** — `setupGallery()` detecta videos por extensión en el pathname de la URL y renderiza `<video preload="metadata" muted playsinline>` con overlay play. Lightbox extendido: `closeLightbox()` pausa y limpia el video al cerrar; `navigateLightbox()` pausa antes de cambiar item; `updateLightboxImage()` conmuta entre `<img>` y `<video>` según el tipo del item activo.

3. **`dashboard/index.html`** — `accept` de `#gallery-input` y `#gallery-edit-input` actualizado a `image/*,image/heic,image/heif,video/mp4,video/quicktime`. Etiqueta del botón de subida actualizada a "Subir Fotos/Videos". Descripción de la galería actualizada con los límites de video. Elemento `<video id="lightbox-video">` agregado al lightbox del perfil.

4. **`profile/index.html`** — Elemento `<video id="lightbox-video" controls playsinline>` agregado como sibling de `<img id="lightbox-image">` dentro del lightbox.

5. **`dashboard.css`** — Estilos para badge "VIDEO" y overlay de ícono play en items de video de la grilla admin.

6. **`artist-profile.css`** — Estilos para overlay play en la grilla pública, estilos del elemento `<video>` dentro del lightbox.

---

## Pre-requisito: verificar límite del bucket en Supabase

Antes de desplegar, confirmar que el bucket `artist-gallery` en Supabase tiene `fileSizeLimit` ≥ 80MB:

1. Ir a **Supabase Console → Storage → artist-gallery → Edit bucket**
2. Verificar el campo "File size limit"
3. Si el límite es 50MB o menos, el código usa 50MB como cap cliente (ya contemplado en la implementación)

---

## Archivos a subir

```
public/shared/js/dashboard.js
public/shared/js/artist-profile.js
public/artist/dashboard/index.html
public/artist/profile/index.html
public/shared/css/dashboard.css
public/shared/css/artist-profile.css
```

---

## Comando

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/js/dashboard.js \
  public/shared/js/artist-profile.js \
  public/artist/dashboard/index.html \
  public/artist/profile/index.html \
  public/shared/css/dashboard.css \
  public/shared/css/artist-profile.css
```

Sin `--restart`. PM2 no necesita reiniciarse.

---

## Verificación

Usar una cuenta de artista en `https://beta.weotzi.com`.

### 1. Subida de video (bloque principal)

Ir a `https://beta.weotzi.com/artist/dashboard/`

1. En el bloque **"Galeria de Trabajos"**, tocar **"Subir Fotos/Videos"**
2. Seleccionar un video MP4 de menos de 30 segundos y menos de 80MB
   - Debe aparecer la barra de progreso mientras sube
   - Al terminar, el video debe aparecer en la grilla con un badge **"VIDEO"** y un ícono de play superpuesto
3. Intentar subir un video de más de 30 segundos → debe mostrar error: `"El video supera los 30 segundos permitidos."`
4. Intentar subir un tercer video (con 2 ya cargados) → debe mostrar: `"Ya tienes el máximo de 2 videos en tu portfolio."`
5. Intentar subir un archivo `.avi` o `.webm` → debe mostrar: `"Solo se permiten videos en formato MP4 o MOV."`

### 2. Subida de video (modo edición)

1. Ir a **"Mi Perfil"** → **"Editar"** → sección **"Galeria de Trabajos"**
2. Tocar **"Subir Imagenes"** (o el texto actualizado)
3. Seleccionar un video MP4 válido → debe subirse y aparecer en la preview de edición con badge "VIDEO"

### 3. Eliminación de video

1. En la grilla admin, tocar la X sobre un video
2. El confirm debe decir `"¿Estás seguro de eliminar este archivo?"` (no "imagen")
3. Tras confirmar, el mensaje de éxito debe decir `"Archivo eliminado correctamente."`

### 4. Visualización en perfil público

Ir a `https://beta.weotzi.com/artist/profile/?artist=<username>`

1. Los videos deben aparecer en la grilla de trabajos con un ícono de play superpuesto
2. Al tocar un video, debe abrirse el lightbox y reproducirse automáticamente
3. Navegar con las flechas del lightbox entre imagen y video → al pasar a imagen, el video debe pausarse; al volver al video, debe reproducirse
4. Cerrar el lightbox (X o clic fuera) → el video debe pausarse completamente

### 5. Cross-browser

Repetir el paso 4 en:
- Chrome Desktop ✓
- Firefox Desktop ✓
- Safari Desktop ✓
- iOS Safari (iPhone) ✓
- Android Chrome ✓
