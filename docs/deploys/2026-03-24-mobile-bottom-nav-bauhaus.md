# Deploy: Menú móvil — Barra inferior Bauhaus

**Fecha:** 2026-03-24
**Skill requerido:** `server-infrastructure`

---

## Qué se cambió

Rediseño del menú de navegación en móvil (≤768px). El header superior se colapsa y los controles (zoom, tema, logout) migran a una **barra fija inferior** con bloques de color al estilo Bauhaus:

- `[-]` y `[+]` zoom — bloques negros
- `(Ö)` tema — círculo amarillo `#F4B942`
- `LOG OUT` — bloque rojo `#E23E28`

Afecta **todas las páginas** de la web con `top-nav-header`. Todos los archivos son estáticos — **no se requiere reiniciar PM2**.

**Cobertura por archivo:**
| Archivo | Páginas cubiertas |
|---|---|
| `landing-style.css` | artist/dashboard, artist/profile, register-artist, registerclosedbeta |
| `dashboard.css` | artist/dashboard (ajuste de márgenes) |
| `client.css` | client/dashboard |
| `quotations.css` | my-quotations, archive, calendar, my-quotations/statistics, support/dashboard |
| `client/login/index.html` | client/login |
| `client/register/index.html` | client/register |
| `support/login/index.html` | support/login |

---

## Archivos a subir

```
public/shared/css/landing-style.css
public/shared/css/client.css
public/shared/css/dashboard.css
public/shared/css/quotations.css
public/client/login/index.html
public/client/register/index.html
public/support/login/index.html
```

---

## Comando

```bash
python .agents/skills/server-infrastructure/scripts/server_deploy.py \
  public/shared/css/landing-style.css \
  public/shared/css/client.css \
  public/shared/css/dashboard.css \
  public/shared/css/quotations.css \
  public/client/login/index.html \
  public/client/register/index.html \
  public/support/login/index.html
```

Sin `--restart`. PM2 no necesita reiniciarse.

---

## Verificación

Probar en viewport ≤768px (DevTools o dispositivo real) en al menos estas páginas:

**Páginas con logout:**
- `https://beta.weotzi.com/artist/dashboard/` — barra: `[-][+](Ö)[LOG OUT rojo]`
- `https://beta.weotzi.com/client/dashboard/` — barra: `[-][+](Ö)[ícono salida rojo]`
- `https://beta.weotzi.com/my-quotations/` — barra: `[-][+](Ö)[LOG OUT rojo]`

**Páginas solo con zoom+tema:**
- `https://beta.weotzi.com/client/login/` — barra: `[-][+](Ö amarillo)`
- `https://beta.weotzi.com/client/register/` — barra: `[-][+](Ö amarillo)`

**Checklist general:**
- La barra inferior aparece fija en la parte baja de la pantalla
- El header superior no es visible (transparente, sin borde)
- `[-]` y `[+]` controlan el zoom correctamente
- El círculo amarillo `Ö` cambia entre modo claro y oscuro
- El bloque rojo cierra sesión correctamente (donde aplica)
- El contenido no queda oculto bajo la barra
- En iPhone (Safari): la barra respeta el área segura inferior (home indicator)
