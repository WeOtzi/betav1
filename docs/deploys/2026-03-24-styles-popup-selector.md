# Deploy: Popup selector de estilos en dashboard del artista

**Fecha:** 2026-03-24
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

El selector de estilos en la edición de perfil del artista fue reemplazado: ya no es un input de texto libre. Ahora es un popup modal con botones multi-selección cargados desde la base de datos, consistente con el flujo de registro. Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

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

Confirmar en `https://beta.weotzi.com/artist/dashboard/`:

1. Hacer clic en **Editar perfil**
2. En la fila **Estilos**, debe aparecer un botón con tags (o placeholder "Seleccionar estilos...") en lugar de un input de texto
3. Al hacer clic en ese botón, debe abrirse un modal con una grilla de botones de estilos
4. Seleccionar varios estilos → deben resaltarse en rojo al seleccionarlos
5. El botón **+ Otro** / input personalizado debe permitir agregar estilos que no están en la lista
6. Al hacer clic en **Confirmar**, el modal se cierra y los estilos seleccionados aparecen como tags en el trigger
7. Al hacer clic en **Cancelar** dentro del modal, la selección anterior no se altera
8. Al guardar el perfil, los estilos deben guardarse correctamente en Supabase (`styles_array`)

Verificar en consola del navegador que no haya errores JS al abrir/cerrar el modal.
