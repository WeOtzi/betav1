// Parser de canvas.fig (formato "fig-kiwi" de Figma) — Node puro, sin dependencias.
// Basado en el formato kiwi de evanw (https://github.com/evanw/kiwi) que Figma usa
// para serializar su árbol de nodos dentro del .fig exportado.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, 'contents', 'canvas.fig');
const buf = fs.readFileSync(FILE);

// ---- Header ----
const magic = buf.slice(0, 8).toString('latin1');
if (!magic.startsWith('fig-')) {
  console.error('Magic inesperado:', JSON.stringify(magic));
  process.exit(1);
}
const version = buf.readUInt32LE(8);
console.error(`magic=${magic} version=${version} total=${buf.length}`);

// ---- Chunks: [u32 size][payload]... ----
const chunks = [];
let off = 12;
while (off + 4 <= buf.length) {
  const size = buf.readUInt32LE(off);
  off += 4;
  if (off + size > buf.length) { console.error(`chunk truncado en ${off} size=${size}`); break; }
  chunks.push(buf.slice(off, off + size));
  off += size;
}
console.error(`chunks=${chunks.length} sizes=${chunks.map(c => c.length).join(',')}`);

function decompress(data) {
  // deflate raw / zlib / zstd / sin comprimir
  try { return zlib.inflateRawSync(data); } catch (e) {}
  try { return zlib.inflateSync(data); } catch (e) {}
  if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) {
    if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(data);
    throw new Error('chunk zstd y este Node no trae zstdDecompressSync');
  }
  return data;
}

const schemaBuf = decompress(chunks[0]);
const dataBuf = decompress(chunks[1]);
console.error(`schema=${schemaBuf.length} bytes, data=${dataBuf.length} bytes`);

// ---- ByteBuffer kiwi ----
class BB {
  constructor(b) { this.b = b; this.i = 0; }
  get eof() { return this.i >= this.b.length; }
  readByte() { if (this.eof) throw new Error('EOF'); return this.b[this.i++]; }
  readVarUint() {
    let shift = 0, result = 0, byte;
    do {
      byte = this.readByte();
      result |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return result >>> 0;
  }
  readVarInt() { const v = this.readVarUint(); return (v & 1) ? ~(v >>> 1) : (v >>> 1); }
  readVarUint64() {
    let shift = 0n, result = 0n, byte;
    do {
      byte = BigInt(this.readByte());
      result |= (byte & 127n) << shift;
      shift += 7n;
    } while (byte & 128n && shift < 64n);
    return result;
  }
  readVarInt64() { const v = this.readVarUint64(); return (v & 1n) ? ~(v >> 1n) : (v >> 1n); }
  readVarFloat() {
    const first = this.readByte();
    if (first === 0) return 0;
    if (this.i + 3 > this.b.length) throw new Error('EOF float');
    let bits = first | (this.b[this.i] << 8) | (this.b[this.i + 1] << 16) | (this.b[this.i + 2] << 24);
    this.i += 3;
    bits = (bits << 23) | (bits >>> 9);
    const ab = new ArrayBuffer(4); new Uint32Array(ab)[0] = bits >>> 0;
    return new Float32Array(ab)[0];
  }
  readString() {
    const start = this.i;
    while (this.i < this.b.length && this.b[this.i] !== 0) this.i++;
    const s = this.b.slice(start, this.i).toString('utf8');
    this.i++; // null
    return s;
  }
  readBytes() {
    const len = this.readVarUint();
    const s = this.b.slice(this.i, this.i + len);
    this.i += len;
    return s;
  }
}

// ---- Decodificar el esquema binario kiwi ----
const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'];
function decodeSchema(b) {
  const bb = new BB(b);
  const count = bb.readVarUint();
  const defs = [];
  for (let i = 0; i < count; i++) {
    const name = bb.readString();
    const kind = KINDS[bb.readByte()];
    const fieldCount = bb.readVarUint();
    const fields = [];
    for (let j = 0; j < fieldCount; j++) {
      const fname = bb.readString();
      const type = bb.readVarInt();
      const isArray = !!(bb.readByte() & 1);
      const value = bb.readVarUint();
      fields.push({ name: fname, type, isArray, value });
    }
    defs.push({ name, kind, fields });
  }
  return defs;
}

const defs = decodeSchema(schemaBuf);
console.error(`definiciones=${defs.length}`);
const defByName = new Map(defs.map(d => [d.name, d]));

// ---- Decodificador genérico de valores ----
const BUILTIN = { '-1': 'bool', '-2': 'byte', '-3': 'int', '-4': 'uint', '-5': 'float', '-6': 'string', '-7': 'int64', '-8': 'uint64' };

function readBuiltin(bb, t) {
  switch (t) {
    case 'bool': return bb.readByte() !== 0;
    case 'byte': return bb.readByte();
    case 'int': return bb.readVarInt();
    case 'uint': return bb.readVarUint();
    case 'float': return bb.readVarFloat();
    case 'string': return bb.readString();
    case 'int64': return bb.readVarInt64();
    case 'uint64': return bb.readVarUint64();
    default: throw new Error('builtin desconocido ' + t);
  }
}

function readValue(bb, type) {
  if (type < 0) {
    const t = BUILTIN[String(type)];
    return readBuiltin(bb, t);
  }
  const def = defs[type];
  if (!def) throw new Error('def idx fuera de rango: ' + type);
  if (def.kind === 'ENUM') {
    const v = bb.readVarUint();
    const f = def.fields.find(f => f.value === v);
    return f ? f.name : v;
  }
  if (def.kind === 'STRUCT') {
    const out = {};
    for (const f of def.fields) out[f.name] = readField(bb, f);
    return out;
  }
  // MESSAGE
  const out = {};
  for (;;) {
    const id = bb.readVarUint();
    if (id === 0) break;
    const f = def.fields.find(f => f.value === id);
    if (!f) throw new Error(`campo ${id} desconocido en ${def.name} @${bb.i}`);
    out[f.name] = readField(bb, f);
  }
  return out;
}

function readField(bb, f) {
  if (f.isArray) {
    // byte[] se codifica como longitud + bytes crudos
    if (f.type === -2) return bb.readBytes();
    const n = bb.readVarUint();
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = readValue(bb, f.type);
    return arr;
  }
  return readValue(bb, f.type);
}

const msgDef = defByName.get('Message');
if (!msgDef) { console.error('No hay tipo Message; tipos:', defs.slice(0, 40).map(d => d.name).join(', ')); process.exit(1); }
const bb = new BB(dataBuf);
const message = readValue(bb, defs.indexOf(msgDef));
console.error(`bytes consumidos=${bb.i}/${dataBuf.length}; nodeChanges=${(message.nodeChanges || []).length}; blobs=${(message.blobs || []).length}`);

// ---- Reconstruir el árbol ----
const nodes = message.nodeChanges || [];
const byGuid = new Map();
const guidKey = g => g ? `${g.sessionID}:${g.localID}` : null;
for (const n of nodes) byGuid.set(guidKey(n.guid), n);
for (const n of nodes) {
  const pk = n.parentIndex ? guidKey(n.parentIndex.guid) : null;
  if (pk && byGuid.has(pk)) {
    const p = byGuid.get(pk);
    (p.__children = p.__children || []).push(n);
  } else {
    n.__root = true;
  }
}
// ordenar hermanos por parentIndex.position (fractional index string)
for (const n of nodes) if (n.__children) n.__children.sort((a, b) => {
  const pa = a.parentIndex && a.parentIndex.position || '';
  const pb = b.parentIndex && b.parentIndex.position || '';
  return pa < pb ? -1 : pa > pb ? 1 : 0;
});

function rgbHex(c) {
  if (!c) return null;
  const h = x => Math.round((x ?? 0) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}` + (c.a !== undefined && c.a < 1 ? h(c.a) : '');
}

function summarize(n, depth, lines, maxDepth) {
  const t = n.type || '?';
  const name = n.name || '';
  const sz = n.size ? ` ${Math.round(n.size.x)}x${Math.round(n.size.y)}` : '';
  const tf = n.transform ? ` @(${Math.round(n.transform.m02)},${Math.round(n.transform.m12)})` : '';
  let extra = '';
  if (t === 'TEXT') {
    const chars = (n.textData && n.textData.characters) || '';
    extra = ` "${chars.slice(0, 80).replace(/\n/g, '\\n')}"`;
    const fill = n.fillPaints && n.fillPaints[0];
    if (fill && fill.color) extra += ` color=${rgbHex(fill.color)}`;
    if (n.fontSize) extra += ` fs=${n.fontSize}`;
    if (n.fontName && n.fontName.family) extra += ` font=${n.fontName.family}`;
  } else {
    const fill = n.fillPaints && n.fillPaints[0];
    if (fill) {
      if (fill.type === 'SOLID' && fill.color) extra += ` fill=${rgbHex(fill.color)}`;
      else if (fill.type === 'IMAGE' && fill.image && fill.image.hash) extra += ` img=${Buffer.from(fill.image.hash).toString('hex').slice(0, 12)}`;
    }
    if (n.cornerRadius) extra += ` r=${n.cornerRadius}`;
  }
  lines.push(`${'  '.repeat(depth)}${t} ${JSON.stringify(name)}${sz}${tf}${extra}`);
  if (depth < maxDepth && n.__children) for (const c of n.__children) summarize(c, depth + 1, lines, maxDepth);
}

const doc = nodes.find(n => n.type === 'DOCUMENT') || nodes.find(n => n.__root);
const pages = (doc && doc.__children || []).filter(n => n.type === 'CANVAS');
console.error(`páginas=${pages.length}: ${pages.map(p => JSON.stringify(p.name)).join(', ')}`);

const outDir = path.join(__dirname, 'parsed');
fs.mkdirSync(outDir, { recursive: true });

// Resumen de nivel superior: páginas y frames raíz
const overview = [];
for (const p of pages) {
  overview.push(`PAGE ${JSON.stringify(p.name)}`);
  for (const f of (p.__children || [])) {
    const sz = f.size ? ` ${Math.round(f.size.x)}x${Math.round(f.size.y)}` : '';
    const tf = f.transform ? ` @(${Math.round(f.transform.m02)},${Math.round(f.transform.m12)})` : '';
    overview.push(`  ${f.type} ${JSON.stringify(f.name)}${sz}${tf}`);
  }
}
fs.writeFileSync(path.join(outDir, 'overview.txt'), overview.join('\n'));

// Árbol detallado por página (profundidad limitada para legibilidad)
for (const p of pages) {
  const lines = [];
  summarize(p, 0, lines, 30);
  const safe = (p.name || 'page').replace(/[^\w\-]+/g, '_').slice(0, 60);
  fs.writeFileSync(path.join(outDir, `tree-${safe}.txt`), lines.join('\n'));
}

// Volcado JSON completo (sin __children circular: usamos referencias por índice)
function stripForJson(n) {
  const { __children, ...rest } = n;
  const out = { ...rest };
  if (rest.guid) out.guid = guidKey(rest.guid);
  if (rest.parentIndex) out.parent = guidKey(rest.parentIndex.guid);
  delete out.parentIndex;
  if (__children) out.children = __children.map(stripForJson);
  return out;
}
fs.writeFileSync(path.join(outDir, 'document.json'), JSON.stringify(pages.map(stripForJson), (k, v) => typeof v === 'bigint' ? String(v) : v instanceof Buffer || (v && v.type === 'Buffer') ? undefined : v));
console.error('OK -> parsed/overview.txt, tree-*.txt, document.json');
