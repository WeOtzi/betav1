# Tooling de importación de Figma (.fig)

Convierte un export local de Figma (`.fig`) en referencias HTML navegables, sin
necesidad de abrir Figma ni de API keys. Se usó para implementar el rediseño
Bauhaus (agosto 2026) a partir de `Pantallas- We Otzi.fig`.

## Cómo funciona

Un `.fig` moderno es un ZIP con `canvas.fig` (árbol de nodos serializado en
formato [kiwi](https://github.com/evanw/kiwi), chunks deflate) + `images/`
(assets embebidos por SHA1) + `thumbnail.png`.

## Uso

```bash
# 1. Preparar carpeta de trabajo
mkdir fig-work && cd fig-work
cp "Pantallas- We Otzi.fig" pantallas.zip
unzip pantallas.zip -d contents        # deja contents/canvas.fig + contents/images/

# 2. Parsear el árbol (genera parsed/overview.txt, tree-*.txt, document.json)
node scripts/figma/parse-fig.js        # espera contents/ junto al script; ajustar FILE si hace falta

# 3. Renderizar cada frame como HTML absoluto fiel (genera render/*.html + index)
node scripts/figma/render-frames.js

# 4. Inspeccionar en el navegador
node scripts/figma/serve.js            # sirve render/ en http://localhost:4646
```

Notas:
- Los scripts esperan las carpetas `contents/`, `parsed/` y `render/` relativas
  a su propio directorio (`__dirname`); copiá los scripts a la carpeta de
  trabajo o ajustá las constantes `FILE`/`ROOT`.
- Cada HTML renderizado reproduce el frame con divs posicionados absolutos:
  textos, colores, tipografías, imágenes y sombras reales. Los íconos vectoriales
  se aproximan como cajas con outline.
- `document.json` conserva el árbol completo (guids, fills, textData, efectos)
  por si hace falta más detalle que el HTML.
