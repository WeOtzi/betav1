# Assets pendientes — pipeline Higgsfield listo para ejecutar

> Estado 2026-07-02: el conector MCP de Higgsfield conectado a Claude Code expone solo
> voz / website-builder / Shorts Studio / ensamblado. Para ejecutar este pipeline hacen
> falta las herramientas de generación (`generate_image`, `generate_video`, `generate_3d`,
> `media_upload`, `job_status`) — revisar la configuración del conector en claude.ai
> (o generar desde la app de Higgsfield y colocar los archivos en las rutas indicadas).

## Dirección visual (obligatoria en todos los assets)

- Sistema "Glaciar/Deshielo": obsidiana `#07080b`, hielo `#9fc2d4` / `#d7e8f0`, ámbar `#e8893b` / ocre `#c75b1e`.
- Fotografía cinematográfica oscura, luz ámbar puntual sobre frío azul; grano de película sutil.
- Nada de logos/marcas inventadas ni texto legible generado (el texto lo pone el sitio).
- Modelos (referencia de costos plan Plus): imagen editorial `recraft-v4-1` standard 2k ≈ 8 cr;
  foto-real cinematográfica: usar `models_explore(action:'recommend')`; video `kling2_6` 5s ≈ 10 cr
  (`sound:false`); image-to-video: `job_id` previo como `medias[].value` con role `start_image`.
- Descarga: usar la URL `_min.webp` de `job_display` (resolución completa, ~70–300KB).

## 1. Poster del video promocional (sección PROMO de la home)

- **Archivo**: `landing/assets/site/promo-poster.webp` (reemplaza el provisional) — 16:9, ≥1600×900.
- **Prompt**: Primer plano cinematográfico de las manos de un tatuador trabajando: guante negro,
  máquina de tatuar con luz ámbar cálida incidiendo sobre la piel, fondo obsidiana profundo con
  bruma azul-hielo, bokeh, grano de película, estilo editorial premium, composición central con
  aire alrededor (un botón de play se superpone al centro).

## 2. Hero corporativo dedicado (opcional — hoy reusa el de tatuadores)

- **Archivos**: `landing/assets/site/hero.webp` (2688×1536) y `hero-mobile.webp` (vertical ~1080×1620).
- **Prompt**: Vista épica de un glaciar oscuro resquebrajándose; entre las grietas emerge un brazo
  tatuado con líneas ancestrales que brillan en ámbar; niebla azul-hielo, escala monumental,
  fotografía cinematográfica, paleta obsidiana/hielo/ámbar.
- Al colocarlos, actualizar `landing/index.html` (preloads + capa `--bg`/`--bg-m` del hero).

## 3. Video promocional (activa la sección PROMO al existir el archivo)

- **Archivo**: `landing/assets/site/promo.mp4` (H.264, 16:9, ≤10MB ideal).
- **Storyboard** (4 clips kling2_6 de 5s, image-to-video desde stills coherentes, + ensamblar
  con `explainer_video`; ~40-45 cr):
  1. Hielo ancestral con un tatuaje congelado dentro; la cámara se acerca (eco de Ötzi).
  2. El hielo se agrieta con luz ámbar irrumpiendo (transición de era).
  3. Manos de tatuador trabajando, tinta y luz cálida (el oficio, presente).
  4. Globo terráqueo nocturno con puntos ámbar encendiéndose en ciudades (alcance global).
- Música: opcional (generate_audio ambient); el reproductor del sitio ya tiene controles.

## 4. Video "Somos We Ötzi" (YouTube embed de la sección SOMOS)

- Producirlo con el workflow `video-explainer` del conector (voz TTS es-LA + subtítulos) usando
  el manifiesto de `docs/MISSION.md` como guion (60–90s). Subirlo a YouTube (canal de la marca)
  y setear `data-yt-id="<ID>"` en `landing/index.html` (bloque `.yt`).

## 5. 3D (petición explícita)

- **Asset**: mesh GLB decorativo — máquina de tatuar estilizada u hacha/amuleto de Ötzi en
  obsidiana con vetas ámbar. Flujo: generar still del objeto (fondo neutro) → `generate_3d`.
- **Integración sugerida** (cuando exista): visor en `/about-us/` con `<model-viewer>`
  vendorizado y lazy-load bajo interacción (respetar regla sin-CDN), o render estático si pesa.
- **Archivo**: `landing/assets/site/otzi-artifact.glb` (+ poster webp de fallback).

## 6. OG definitivas (hoy: crops correctos 1200×630 de arte existente, ya en su sitio)

- `og-home.webp`, `og-about.webp`, `og-faqs.webp` — si se generan artes dedicadas, mantener
  1200×630, <200KB, sin texto pequeño (Facebook/WhatsApp las comprimen).
