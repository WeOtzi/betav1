# Deploy: Barra de progreso de carga del portfolio

**Fecha:** 2026-03-25
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Se agregó una barra de progreso visual al proceso de carga de imágenes del portfolio en el dashboard del artista. Reemplaza el spinner anterior y aplica a los dos puntos de subida. Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

### Cambios

1. **Bloque "Galeria de Trabajos"** — El spinner y el texto "Subiendo imagenes..." fueron reemplazados por una barra de progreso horizontal con label ("Subiendo imagenes"), contador (`1 / 3`) y fill animado que avanza en tiempo real conforme cada imagen es procesada y subida.

2. **Modo edición del perfil** — Se agregó la misma barra de progreso debajo del botón "Subir Imagenes" en la sección de galería del panel de edición. Antes solo cambiaba el texto del botón.

3. **Estilos** — Nueva familia de clases CSS (`.gallery-upload-progress`, `.gallery-progress-track`, `.gallery-progress-fill`) con soporte explícito para modo oscuro vía `.dark-mode .gallery-progress-track`. Usa `transition: width 0.35s ease` con prefijo `-webkit-` para compatibilidad con Safari.

---

## Archivos a subir

```
public/artist/dashboard/index.html
public/shared/css/dashboard.css
public/shared/js/dashboard.js
```

---

## Comando

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/artist/dashboard/index.html \
  public/shared/css/dashboard.css \
  public/shared/js/dashboard.js
```

Sin `--restart`. PM2 no necesita reiniciarse.

---

## Verificación

Abrir `https://beta.weotzi.com/artist/dashboard/` con una cuenta de artista:

1. En el bloque **"Galeria de Trabajos"**, tocar **"Subir Fotos"** y seleccionar 2 o más imágenes
   - Debe aparecer la barra de progreso con el label "SUBIENDO IMAGENES" y el contador `1 / N`
   - La barra amarilla debe avanzar con cada imagen completada
   - Al terminar, la barra desaparece y aparece el mensaje de éxito
2. Ir a **"Mi Perfil"** → **"Editar"** → sección **"Galeria de Trabajos"**, tocar **"Subir Imagenes"**
   - Debe aparecer la misma barra de progreso debajo del botón
   - El botón no debe cambiar de texto (comportamiento anterior)
   - Al terminar, la barra desaparece
3. Verificar en **modo oscuro** (botón Ö en el header): el track de la barra debe verse visible sobre fondo oscuro
4. Verificar en **mobile** (iOS Safari y Android Chrome): la barra debe mostrarse correctamente y la transición de ancho debe ser suave
