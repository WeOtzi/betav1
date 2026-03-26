# Deploy: Autocompletado de dirección en el dashboard del artista

**Fecha:** 2026-03-25
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Se agregó autocompletado de dirección con Google Places y botón de geolocalización automática al campo de ubicación en el formulario de edición del dashboard del artista. Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

### Funcionalidad nueva

1. **Autocompletado al escribir** — Al escribir en el campo "Ubicación" durante el modo edición, aparece un dropdown con sugerencias de Google Places. Al seleccionar una, el campo se rellena con la dirección formateada.

2. **Botón de geolocalización** — Botón con ícono de crosshair junto al campo. Al pulsarlo:
   - Intenta obtener la ubicación por GPS (`navigator.geolocation`)
   - Si el GPS no está disponible o hay timeout, hace fallback automático por IP (`ipapi.co`)
   - Si el permiso GPS es denegado explícitamente, muestra mensaje claro sin fallback
   - Muestra feedback en tiempo real debajo del campo ("Obteniendo ubicación...", "¡Ubicación detectada!", etc.)

3. **Compatible con todos los sistemas operativos y navegadores** — iOS Safari, Android Chrome/Firefox, Desktop Windows/Mac/Linux.

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

1. Hacer clic en **"Editar"** para entrar al modo edición
2. Verificar que el campo **"Ubicación"** muestra un input con un botón de crosshair a la derecha
3. **Autocompletado:** Escribir una ciudad (ej. "Buenos Aires") → debe aparecer el dropdown de sugerencias de Google Places → seleccionar una opción → el campo debe llenarse con la dirección completa
4. **Geolocalización:** Hacer clic en el botón de crosshair → el navegador debe pedir permiso de ubicación → al aceptar, el campo debe llenarse automáticamente con la ciudad/provincia/país detectada
5. **Geolocalización denegada:** Repetir con permiso denegado → debe aparecer el mensaje "Permiso de ubicación denegado. Ingrésala manualmente." sin que la app se cuelgue
6. Guardar el perfil con la ubicación detectada → verificar que se guarda correctamente en Supabase y se muestra en el perfil público

### Prueba en móvil

Probar el paso 4 desde un iPhone (Safari) y desde un Android (Chrome) — la geolocalización debe funcionar en ambos.
