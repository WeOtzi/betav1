# We Ötzi · Design System (Bauhaus Edition) — capa CSS del producto

Fuente de verdad: Figma [“Design System We Otzi”](https://www.figma.com/design/jLxPQyG2rxrq5bvfQgNcBd/Design-System-We-Otzi), archivo `jLxPQyG2rxrq5bvfQgNcBd`.
Esta carpeta es la traducción vanilla-CSS de ese sistema para las páginas de `public/`.

## Cómo incluirlo en una página

```html
<link rel="stylesheet" href="/shared/css/ds/tokens.css">
<link rel="stylesheet" href="/shared/css/ds/components.css">
<link rel="stylesheet" href="/shared/css/ds/site-components.css">
<link rel="stylesheet" href="/shared/css/ds/molecules.css">
<link rel="stylesheet" href="/shared/css/ds/organisms.css">
<script src="/shared/js/wo-icons.js" defer></script>
<script src="/shared/js/ds/site-components.js" defer></script>
<script src="/shared/js/ds/organisms.js" defer></script>
<script src="/shared/js/ds/molecules.js" defer></script>
```

`<body class="wo-app">` activa los resets (fondo crema, selección amarilla, focus ring).

Las capas CSS se cargan de menor a mayor composición: tokens y primitivas, 21 tableros
del UI Kit, 28 moléculas y 17 organismos. En JavaScript, `organisms.js` debe preceder a
`molecules.js` porque las moléculas reutilizan su fixture compartido. El catálogo vive en
`/componentes/`; los ejemplos agrupados y el dashboard completo están en
`/componentes/compuestos/`.

Los tableros de documentación reproducen las medidas, textos y fondos de sus frames de
Figma. Por eso sus wrappers pueden usar valores literales o el gradiente del lienzo original;
esas excepciones visuales no cambian las reglas de los componentes de producto.

## Reglas duras (del manual — no negociables)

1. **Radius 0 en todo** (botones, inputs, cards, tags, navbar). Excepciones cerradas:
   badge píldora `2px`, avatar/dots `999px`.
2. **Sin sombra en reposo.** La sombra dura (`--shadow-hard-sm`) es feedback de hover:
   el control se levanta `translate(-2px,-2px)` y proyecta la sombra; al presionar vuelve
   a 0 sin sombra. `--shadow-focus` es la única sombra permanente y **nunca** se suprime.
3. **Hover oscurece un paso de rampa**, nunca aclara ni cambia opacidad.
4. **Jerarquía por borde y espacio**: 1px `--border-subtle` divide filas, 2px ink contiene
   un objeto, 3px ink cierra sección. Preferir `.wo-divider` + espacio antes que anidar cards.
5. **El color comunica**: todo color sale de un token semántico. Nada de hex sueltos.
6. **Escala 4pt**: paddings/margins solo con `--space-N` (N × 4px). Nada de `22px` a ojo.
7. **Tipografía**: Archivo Black = todo titular/número/inicial/tab. Inter = cuerpo, UI,
   botones (700 uppercase +4%). JetBrains Mono = eyebrows, labels, nav (11px), precios,
   timestamps, estados (`Confirmado`, `Pendiente`…), contadores.
8. **Amarillo `--action-accent`: UN botón accent por vista.**
9. **Íconos: Feather 4.29.2** vía `data-wo-icon="name"` (wo-icons.js). Nunca Font Awesome
   ni emoji. 24px default, 18px en controles compactos. `★ ♡ ♥ → ← ·` son los únicos
   glifos Unicode permitidos.
10. **Copy: español rioplatense (voseo)** — *Probá, Contá, Ingresá, Subí, Postulate*.
    Sentence case (nunca Title Case); UPPERCASE solo vía CSS en botones/meta/nav.
    Separador universal `·`. Números europeos: `4.820`, `$3.150.000`. Rangos `$200 – $400`.
    Acciones que navegan terminan en `→`. Sin signos de exclamación, sin hype.
11. **Sin modo oscuro**: el sistema es crema (`--surface-page`); solo navbar y galería de
    trabajos pueden usar `--surface-inverse`. No agregar toggles de tema en páginas nuevas.
12. **Sin gradientes decorativos ni blur.** Solo los 2 gradientes de protección sobre
    imagen (`--protection-bottom`, `--protection-diagonal`).

## Inventario de clases

Tipografía: `wo-display wo-h1 wo-h2 wo-h3 wo-body-l wo-body-s wo-eyebrow wo-meta wo-meta-s wo-highlight`
Layout: `wo-container wo-section wo-divider(--strong|--rule)`
Botones: `wo-btn` + `--accent --direct --danger --ghost --secondary --ink --s --block --hard --mono --nav`, `wo-iconbtn(--s)`
Formularios: `wo-field wo-label wo-help wo-error-msg wo-input wo-textarea wo-select wo-check wo-radio wo-toggle wo-dropzone`
Badges/Tags: `wo-badge(--s --accent --error --success --info --outline --pill)`, `wo-tag(--filled --highlight --info --active --urgent --archived --soft)`, `wo-chip(.is-active .is-dim)`
Cards: `wo-card(--flat --rule --media --hover --inverse)`, `wo-media(--protect)`, `wo-corner-flag--*`
Nav: `wo-topbar wo-topbar-brand wo-topbar-nav wo-topbar-item wo-topbar-right wo-o-tile wo-marks`, `wo-tabs wo-tab`, `wo-sidebar wo-sidebar-item`
Datos: `wo-table`, `wo-agenda-row`, `wo-stat wo-statstrip`
Feedback: `wo-alert--(success|error|warning|info) wo-empty wo-progress wo-skeleton wo-spinner wo-dots wo-stepper wo-step`
Overlay: `wo-overlay wo-modal(--inverse) wo-modal-title wo-modal-actions`
Utils: `wo-mono-num wo-muted wo-faint wo-sep wo-hidden wo-sr-only`
