# Deploy: Fix bio con formato en Safari iOS

**Fecha:** 2026-03-25
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Corrección de 4 bugs que impedían escribir y guardar una bio con formato (negritas, cursiva, colores) desde iPhone en Safari. Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

### Bugs corregidos

1. **Enter avanzaba el formulario desde el editor de bio** — El listener global de `keydown` no excluía elementos `contenteditable`. En iOS Safari el `stopPropagation()` del editor fallaba, haciendo que Enter creara una línea nueva Y avanzara al paso siguiente.

2. **Botones del toolbar perdían la selección en iOS Safari** — Al tocar un botón de formato, el `contenteditable` perdía el focus antes de que `execCommand` se ejecutara, por lo que el formato no se aplicaba.

3. **Color pickers destruían la selección** — Abrir el selector de color nativo del iPhone descartaba la selección del texto. Ahora se guarda y restaura con la Selection API. Además se añadió fallback `backColor` para iOS Safari donde `hiliteColor` no está soportado.

4. **Formato no se guardaba en la base de datos desde iOS Safari** — Safari genera `<span style="font-weight: bold">` en lugar de `<b>` para las negritas. `font-weight`, `font-style` y `text-decoration` no estaban en la lista de propiedades CSS permitidas del sanitizador, así que el formato se eliminaba al guardar.

---

## Archivos a subir

```
public/shared/js/register.js
public/shared/js/bio-formatting.js
```

---

## Comando

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/js/register.js \
  public/shared/js/bio-formatting.js
```

Sin `--restart`. PM2 no necesita reiniciarse.

---

## Verificación

Probar en iPhone con Safari en `https://beta.weotzi.com/register-artist/`:

1. Navegar hasta el **paso 9 (Bio)**
2. Escribir texto, presionar **Enter** para crear líneas nuevas → el formulario NO debe avanzar al paso 10
3. Seleccionar texto y tocar **B** (negrita) → el texto debe quedar en negrita
4. Seleccionar texto y tocar **I** (cursiva) → el texto debe quedar en cursiva
5. Seleccionar texto y tocar el selector de **color** → el color debe aplicarse y conservarse
6. Completar el registro → en el dashboard, la bio debe mostrar todo el formato (negritas, colores, etc.) sin perderlo
