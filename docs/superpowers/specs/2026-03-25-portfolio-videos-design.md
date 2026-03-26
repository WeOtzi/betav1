# Spec: Videos en Portfolio de Artistas

**Fecha:** 2026-03-25
**Estado:** Aprobado (revisado post-review)

---

## Resumen

Agregar soporte para subir y visualizar videos cortos en la galería de trabajos del artista. Máximo 2 videos de hasta 30 segundos, compatibles con todos los navegadores y dispositivos, subidos directamente a Supabase Storage sin procesamiento en servidor.

---

## Contexto y restricciones

- El servidor es compartido y de recursos limitados → sin transcodificación server-side
- Backend de almacenamiento: Supabase Storage (bucket `artist-gallery`)
- Metadata de galería: columna `gallery_images` (array de URLs) en tabla `artists_db`
- Límite actual: 12 archivos totales (imágenes)
- Compatibilidad de formato: H.264 MP4 es universal en Chrome, Firefox, Safari, Edge, iOS, Android
- El bucket `artist-gallery` en Supabase debe tener `fileSizeLimit` configurado a ≥80MB (verificar en consola Supabase antes de implementar; si el límite es menor, bajar el cap cliente a 50MB)

---

## Modelo de datos

**Sin migración de base de datos.** Se reutiliza la columna `gallery_images` existente. Los videos se identifican por extensión en el pathname de la URL:

```js
// Usar pathname para evitar falsos negativos con query strings (?t=1234, etc.)
const isVideoUrl = (url) => {
    try {
        return /\.(mp4|mov)$/i.test(new URL(url).pathname);
    } catch {
        return /\.(mp4|mov)$/i.test(url);
    }
};

const isVideoFile = (file) =>
    file.type === 'video/mp4' || file.type === 'video/quicktime';
```

**Límites:**
- Total de archivos (imágenes + videos): máx 12
- Videos: máx 2
- Duración: máx 30 segundos (validado cliente-side)
- Tamaño: máx 80 MB por video (ajustar a 50MB si el bucket de Supabase lo requiere)
- Formatos aceptados: `.mp4`, `.mov` (video/mp4, video/quicktime)

---

## Flujo de subida (cliente)

```
Usuario selecciona archivo de video
  → Validar tipo: video/mp4 o video/quicktime
      → Error: "Solo se permiten videos en formato MP4 o MOV."
  → Contar videos actuales: gallery_images.filter(isVideoUrl).length
      → Error si ≥ 2: "Ya tienes el máximo de 2 videos en tu portfolio."
  → Contar total: gallery_images.length
      → Error si ≥ 12: "No hay espacio disponible (máx 12 archivos)."
  → Validar tamaño ≤ 80MB
      → Error: "El video supera los 80MB permitidos."
  → Crear <video> temporal, asignar src = URL.createObjectURL(file)
  → Escuchar evento 'loadedmetadata' con timeout de 10 segundos y onerror:
      → Si onerror o timeout: revocar objectURL → Error: "No se pudo leer el video. Verifica que el archivo no esté dañado."
      → Leer video.duration
      → Revocar objectURL inmediatamente
  → Validar duración ≤ 30s
      → Error: "El video supera los 30 segundos permitidos."
  → Subir directamente a Supabase bucket 'artist-gallery'
      → IMPORTANTE: los videos NO pasan por UploadQueue (que aplica compresión de imagen)
      → Subida directa: supabase.storage.from('artist-gallery').upload(filePath, file, {...})
  → Obtener URL pública
  → Actualizar gallery_images en DB con nueva URL
  → Re-renderizar grilla del admin
  → Si el video es .mov, mostrar toast/aviso: "Video subido. Nota: el formato MOV puede no reproducirse en Firefox. Se recomienda MP4 para mayor compatibilidad."
```

---

## Renderizado — Panel de administración (dashboard.js)

La función `renderGalleryAdmin()` y `renderGalleryEditPreview()` detectan si cada URL es video o imagen:

- **Imagen**: `<img src="..." loading="lazy">` (igual que hoy)
- **Video**: `<video src="..." preload="metadata" muted playsinline>` con overlay de badge "VIDEO" e ícono play

El botón de eliminar usa copy genérico en el confirm dialog: `"¿Estás seguro de eliminar este archivo?"` (no dice "imagen").

El mensaje de éxito tras eliminar: `"Archivo eliminado correctamente."` (en ambas funciones `deleteGalleryImage` y `deleteGalleryEditImage`).

El `aria-label` del botón de eliminar: `aria-label="Eliminar video"` para items de video, `aria-label="Eliminar imagen"` para imágenes.

---

## Renderizado — Perfil público (artist-profile.js)

### Grilla de trabajos

`setupGallery()` itera `gallery_images` y genera HTML diferente por tipo. El orden de visualización es el orden de subida (los artistas gestionan su propio orden). Videos que queden fuera del cap de 6 items visibles son accesibles solo vía lightbox "Ver toda la galería".

- **Imagen**: igual que hoy (`<img>` con onclick a lightbox)
- **Video**: `<video preload="metadata" muted playsinline>` con overlay de ícono play, onclick abre lightbox en modo video

### Lightbox

El lightbox tiene `<img id="lightbox-image">` y se agrega `<video id="lightbox-video" controls playsinline>`. Solo uno es visible a la vez según el tipo del item activo.

**`updateLightboxImage()`** (renombrar mentalmente a `updateLightboxItem()`):
- Si el item es video: ocultar `<img>`, mostrar `<video>`, asignar `src`, llamar `.play()`
- Si el item es imagen: pausar y resetear `<video>` si estaba activo (`video.pause(); video.src = ''`), ocultar `<video>`, mostrar `<img>`, asignar `src`

**`closeLightbox()`** — extender para pausar video:
```js
function closeLightbox() {
    const video = document.getElementById('lightbox-video');
    if (video) { video.pause(); video.src = ''; }
    const lightbox = document.getElementById('gallery-lightbox');
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
}
```

**`navigateLightbox()`** — pausar video antes de cambiar item:
```js
function navigateLightbox(direction) {
    const video = document.getElementById('lightbox-video');
    if (video) { video.pause(); }
    // ... lógica existente de navegación
}
```

---

## Compatibilidad cross-browser

| Formato | Chrome | Firefox | Safari | Edge | iOS Safari | Android Chrome |
|---------|--------|---------|--------|------|------------|----------------|
| MP4 H.264 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MOV (H.264) | ✓ | Parcial | ✓ | ✓ | ✓ | ✓ |

Los `.mov` grabados en iPhone usan H.264 internamente y son compatibles en la mayoría de browsers, con excepción parcial de Firefox. Se muestra aviso al artista tras subir `.mov`.

---

## Archivos a modificar

| Archivo | Cambios |
|---------|---------|
| `public/shared/js/dashboard.js` | `handleGalleryUpload`, `handleGalleryEditUpload`, `renderGalleryAdmin`, `renderGalleryEditPreview`, `deleteGalleryImage`, `deleteGalleryEditImage` — agregar lógica de videos |
| `public/shared/js/artist-profile.js` | `setupGallery`, `updateLightboxImage`, `closeLightbox`, `navigateLightbox` |
| `public/artist/dashboard/index.html` | `accept="image/*,image/heic,image/heif,video/mp4,video/quicktime"` en `#gallery-input` y `#gallery-edit-input`; etiqueta del botón: `"Subir Fotos/Videos"`; descripción: `"Sube imágenes o videos de tus trabajos (máx 12 en total, máx 2 videos de hasta 30 segundos, MP4/MOV)."` |
| `public/artist/profile/index.html` | Agregar `<video id="lightbox-video">` en el lightbox |
| `public/shared/css/dashboard.css` | Badge "VIDEO", overlay play en items de video del admin |
| `public/shared/css/artist-profile.css` | Overlay play en grilla pública, estilos video en lightbox |

---

## Fuera de alcance

- Transcodificación o compresión server-side
- Generación de thumbnails automáticos server-side
- Soporte para YouTube/Vimeo embeds
- Subtítulos o accesibilidad de video avanzada
- Reordenamiento manual de items en la galería
