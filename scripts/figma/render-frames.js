// Renderiza cada frame de nivel superior del document.json a un HTML standalone
// con divs posicionados absolutos: la referencia visual del diseño sin Figma.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'parsed', 'document.json'), 'utf8'));
const IMG_SRC = path.join(ROOT, 'contents', 'images');
const OUT = path.join(ROOT, 'render');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });

// Copiar imágenes con extensión según magic bytes
const imgExt = new Map();
for (const f of fs.readdirSync(IMG_SRC)) {
  const b = fs.readFileSync(path.join(IMG_SRC, f));
  let ext = 'bin';
  if (b[0] === 0x89 && b[1] === 0x50) ext = 'png';
  else if (b[0] === 0xff && b[1] === 0xd8) ext = 'jpg';
  else if (b.slice(0, 4).toString() === 'RIFF') ext = 'webp';
  else if (b.slice(0, 4).toString('hex') === '3c737667' || b.slice(0, 5).toString() === '<?xml') ext = 'svg';
  imgExt.set(f.toLowerCase(), ext);
  fs.writeFileSync(path.join(OUT, 'images', `${f}.${ext}`), b);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = c => {
  if (!c) return null;
  const h = x => Math.round(Math.max(0, Math.min(1, x ?? 0)) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
};
const rgba = (c, extraOpacity = 1) => {
  if (!c) return null;
  const a = (c.a ?? 1) * extraOpacity;
  return a >= 1 ? hex(c) : `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a.toFixed(3)})`;
};

function imageHashHex(image) {
  if (!image || !image.hash) return null;
  const h = image.hash;
  // tras JSON.stringify un Buffer se volvió {type:'Buffer',data:[...]} o quedó como objeto {0:..}; manejar ambos
  let bytes = null;
  if (Array.isArray(h)) bytes = h;
  else if (h.data) bytes = h.data;
  else if (typeof h === 'object') bytes = Object.keys(h).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b).map(k => h[k]);
  if (!bytes || !bytes.length) return null;
  return Buffer.from(bytes).toString('hex');
}

function paintCss(paints, target) {
  // devuelve {background, backgroundImage} para el primer paint visible
  if (!Array.isArray(paints)) return {};
  const visible = paints.filter(p => p.visible !== false);
  if (!visible.length) return {};
  const layers = [];
  let solid = null;
  for (const p of visible) {
    const op = p.opacity ?? 1;
    if (p.type === 'SOLID' && p.color) solid = rgba(p.color, op);
    else if (p.type === 'IMAGE') {
      const hh = imageHashHex(p.image);
      if (hh && imgExt.has(hh)) layers.push(`url(images/${hh}.${imgExt.get(hh)}) center/cover no-repeat`);
      else solid = solid || '#D5CFC0';
    } else if (p.type && p.type.startsWith('GRADIENT')) {
      const stops = (p.stops || []).map(s => `${rgba(s.color, op)} ${Math.round((s.position ?? 0) * 100)}%`).join(',');
      if (stops) layers.push(`linear-gradient(180deg,${stops})`);
    }
  }
  const css = {};
  if (layers.length) css.background = layers.join(',') + (solid ? `,${solid}` : '');
  else if (solid) css.background = solid;
  return css;
}

const FONT_FALLBACK = { 'Archivo Black': "'Archivo Black',sans-serif", 'Inter': "Inter,sans-serif", 'JetBrains Mono': "'JetBrains Mono',monospace" };

function nodeStyle(n, x, y) {
  const s = [`left:${x.toFixed(1)}px`, `top:${y.toFixed(1)}px`];
  const w = n.size ? n.size.x : 0, h = n.size ? n.size.y : 0;
  s.push(`width:${w.toFixed(1)}px`, `height:${h.toFixed(1)}px`);
  if (n.opacity !== undefined && n.opacity < 1) s.push(`opacity:${n.opacity.toFixed(3)}`);
  const t = n.type;
  if (t !== 'TEXT') {
    const fill = paintCss(n.fillPaints);
    if (fill.background) s.push(`background:${fill.background}`);
    if (Array.isArray(n.strokePaints) && n.strokePaints.length && n.strokePaints[0].visible !== false && n.strokePaints[0].color) {
      const sw = n.strokeWeight ?? 1;
      s.push(`box-shadow:inset 0 0 0 ${sw}px ${rgba(n.strokePaints[0].color, n.strokePaints[0].opacity ?? 1)}`);
    }
    if (t === 'ELLIPSE') s.push('border-radius:50%');
    else if (n.cornerRadius) s.push(`border-radius:${n.cornerRadius}px`);
    else if (n.rectangleTopLeftCornerRadius || n.rectangleTopRightCornerRadius || n.rectangleBottomLeftCornerRadius || n.rectangleBottomRightCornerRadius) {
      s.push(`border-radius:${n.rectangleTopLeftCornerRadius || 0}px ${n.rectangleTopRightCornerRadius || 0}px ${n.rectangleBottomRightCornerRadius || 0}px ${n.rectangleBottomLeftCornerRadius || 0}px`);
    }
  }
  // sombras duras
  if (Array.isArray(n.effects)) {
    const shadows = n.effects.filter(e => e.type === 'DROP_SHADOW' && e.visible !== false)
      .map(e => `${(e.offset && e.offset.x || 0)}px ${(e.offset && e.offset.y || 0)}px ${e.radius || 0}px ${rgba(e.color) || '#000'}`);
    if (shadows.length) s.push(`box-shadow:${s.find(x => x.startsWith('box-shadow')) ? '' : ''}${shadows.join(',')}`);
  }
  if (n.type === 'FRAME' && n.frameMaskDisabled !== true && (n.__hasChildren)) s.push('overflow:hidden');
  return s.join(';');
}

function textStyle(n) {
  const s = [];
  const fam = n.fontName && n.fontName.family;
  s.push(`font-family:${FONT_FALLBACK[fam] || (fam ? `'${fam}',sans-serif` : 'sans-serif')}`);
  if (n.fontSize) s.push(`font-size:${n.fontSize}px`);
  const style = (n.fontName && n.fontName.style || '').toLowerCase();
  if (style.includes('bold')) s.push('font-weight:700');
  else if (style.includes('black')) s.push('font-weight:900');
  else if (style.includes('semi')) s.push('font-weight:600');
  else if (style.includes('medium')) s.push('font-weight:500');
  if (style.includes('italic')) s.push('font-style:italic');
  const fill = n.fillPaints && n.fillPaints[0];
  if (fill && fill.color) s.push(`color:${rgba(fill.color, fill.opacity ?? 1)}`);
  if (n.textAlignHorizontal === 'CENTER') s.push('text-align:center');
  else if (n.textAlignHorizontal === 'RIGHT') s.push('text-align:right');
  if (n.letterSpacing && n.letterSpacing.value) {
    const u = n.letterSpacing.units === 'PERCENT' ? `${(n.letterSpacing.value / 100).toFixed(3)}em` : `${n.letterSpacing.value}px`;
    s.push(`letter-spacing:${u}`);
  }
  if (n.lineHeight && n.lineHeight.value && n.lineHeight.units !== 'RAW') {
    s.push(n.lineHeight.units === 'PERCENT' ? `line-height:${(n.lineHeight.value / 100).toFixed(2)}` : `line-height:${n.lineHeight.value}px`);
  }
  if (n.textCase === 'UPPER') s.push('text-transform:uppercase');
  s.push('white-space:pre-wrap');
  return s.join(';');
}

let symbolsById = new Map();
function indexSymbols(pagesArr) {
  for (const p of pagesArr) for (const c of (p.children || [])) {
    if (c.type === 'SYMBOL') symbolsById.set(c.guid, c);
  }
}

function renderNode(n, ox, oy, out, depth) {
  if (n.visible === false) return;
  if (depth > 60) return;
  const tf = n.transform || { m02: 0, m12: 0 };
  const x = ox + (tf.m02 || 0), y = oy + (tf.m12 || 0);
  const t = n.type;
  n.__hasChildren = !!(n.children && n.children.length);
  if (t === 'TEXT') {
    const chars = (n.textData && n.textData.characters) || '';
    out.push(`<div class="n t" data-name="${esc(n.name || '')}" style="${nodeStyle(n, x, y)};${textStyle(n)}">${esc(chars)}</div>`);
    return;
  }
  if (t === 'INSTANCE' && n.symbolData && n.symbolData.symbolID) {
    const symKey = `${n.symbolData.symbolID.sessionID}:${n.symbolData.symbolID.localID}`;
    const sym = symbolsById.get(symKey);
    out.push(`<div class="n" data-name="${esc(n.name || '')}" style="${nodeStyle(n, x, y)}">`);
    if (sym) {
      for (const c of (sym.children || [])) renderNode(c, 0, 0, out, depth + 1);
    }
    out.push('</div>');
    return;
  }
  const isShape = ['RECTANGLE', 'ROUNDED_RECTANGLE', 'ELLIPSE', 'VECTOR', 'STAR', 'LINE', 'REGULAR_POLYGON', 'BOOLEAN_OPERATION'].includes(t);
  if (isShape && !n.children) {
    let extra = '';
    if ((t === 'VECTOR' || t === 'BOOLEAN_OPERATION' || t === 'LINE') && !(n.fillPaints && n.fillPaints.length)) {
      // vector sin fill: probablemente ícono de trazo — caja con borde del color del stroke
      const sp = n.strokePaints && n.strokePaints[0];
      if (sp && sp.color) extra = `;outline:1.5px solid ${rgba(sp.color)};outline-offset:-1.5px`;
    }
    out.push(`<div class="n s ${t.toLowerCase()}" data-name="${esc(n.name || '')}" style="${nodeStyle(n, x, y)}${extra}"></div>`);
    return;
  }
  // FRAME / GROUP / SYMBOL / otros contenedores
  out.push(`<div class="n f" data-name="${esc(n.name || '')}" style="${nodeStyle(n, x, y)}">`);
  for (const c of (n.children || [])) renderNode(c, 0, 0, out, depth + 1);
  out.push('</div>');
}

indexSymbols(pages);

const index = [];
for (const p of pages) {
  if (p.name === 'Internal Only Canvas') continue;
  const pageSlug = p.name.replace(/[^\w]+/g, '-').toLowerCase();
  let i = 0;
  for (const f of (p.children || [])) {
    if (f.type !== 'FRAME') continue;
    i++;
    const w = f.size ? f.size.x : 1440, h = f.size ? f.size.y : 900;
    const slug = `${pageSlug}--${String(i).padStart(2, '0')}-${(f.name || 'frame').replace(/[^\w]+/g, '-').toLowerCase()}`;
    const out = [];
    // render frame en (0,0)
    const rootTf = f.transform; f.transform = { m02: 0, m12: 0 };
    renderNode(f, 0, 0, out, 0);
    f.transform = rootTf;
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(f.name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#eee}.stage{position:relative;width:${w}px;height:${h}px;margin:0 auto;background:#fff}.n{position:absolute;box-sizing:border-box}.t{overflow:visible}</style>
<div class="stage">${out.join('')}</div>`;
    fs.writeFileSync(path.join(OUT, `${slug}.html`), html);
    index.push({ page: p.name, name: f.name, slug, w, h });
  }
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Frames</title><body style="font-family:monospace">${index.map(e => `<div><a href="${e.slug}.html">[${esc(e.page)}] ${esc(e.name)} (${Math.round(e.w)}x${Math.round(e.h)})</a></div>`).join('')}`);
console.log(`OK ${index.length} frames -> render/`);
