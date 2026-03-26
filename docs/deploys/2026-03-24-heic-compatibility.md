# Deploy: Compatibilidad HEIC de imágenes

**Fecha:** 2026-03-24
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Implementación de soporte para imágenes HEIC/HEIF en todos los puntos de subida de imágenes del frontend. Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

---

## Archivos a subir

```
public/shared/js/heic-converter.js       ← NUEVO
public/shared/js/dashboard.js
public/shared/js/script.js
public/shared/js/job-board-request.js
public/artist/dashboard/index.html
public/quotation/index.html
public/job-board/request/index.html
```

---

## Comando

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/js/heic-converter.js \
  public/shared/js/dashboard.js \
  public/shared/js/script.js \
  public/shared/js/job-board-request.js \
  public/artist/dashboard/index.html \
  public/quotation/index.html \
  public/job-board/request/index.html
```

Sin `--restart`. PM2 no necesita reiniciarse.

---

## Verificación

Confirmar que `https://beta.weotzi.com/artist/dashboard/` carga sin errores de consola:
- `heic2any is not defined` → no debe aparecer
- `imageCompression is not defined` → no debe aparecer
- `convertIfHEIC is not defined` → no debe aparecer
