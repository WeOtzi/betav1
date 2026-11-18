'use strict';

// ===========================================================================
// Huellas de imágenes (puro, sin dependencias) — fase 2 del plan de identidad
// y suplantación (docs/plans/2026-11-18-kyc-antisuplantacion.md §2.1).
// ---------------------------------------------------------------------------
// Entrada: píxeles en escala de grises { data: Uint8Array, width, height }
// (lib/image-decode.js los saca de sharp). Salida: hashes de 64 bits en hex de
// 16 caracteres, el formato que guarda image_fingerprints (bit(64)).
//
//   phash(gray)        DCT 32×32 → bloque 8×8 de baja frecuencia → bit = coef > mediana
//                      (la mediana no cuenta el término DC)
//   phashMirror(gray)  pHash de la imagen espejada en horizontal (el truco más
//                      común para esquivar la detección)
//   dhash(gray)        9×8 → bit = píxel > vecino de la derecha
//   hamming(a, b)      bits distintos entre dos hex de 64 bits
//   sha256(buffer)     copia exacta byte a byte
//   confidenceFor(distance, sameSha) → 'casi_segura' | 'posible' | null
//
// Umbrales: MATCH_THRESHOLD (aviso a soporte) y SEARCH_THRESHOLD (buscador).
// ===========================================================================

const crypto = require('node:crypto');

const MATCH_THRESHOLD = 8;
const SEARCH_THRESHOLD = 12;
const NEAR_CERTAIN_MAX = 2;

const PHASH_SIZE = 32;
const PHASH_BLOCK = 8;
const HEX_RE = /^[0-9a-f]{16}$/;

function assertGray(gray) {
    if (!gray || typeof gray !== 'object') throw new TypeError('gray: se espera { data, width, height }');
    const { data, width, height } = gray;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new TypeError('gray: width y height deben ser enteros positivos');
    }
    if (!data || typeof data.length !== 'number' || data.length < width * height) {
        throw new TypeError('gray: data no tiene width × height píxeles');
    }
}

// Redimensiona promediando áreas (cada píxel de destino es el promedio
// ponderado de los píxeles de origen que cubre). Para agrandar se comporta
// como vecino más cercano. Devuelve Float64Array de w × h.
function resizeArea(gray, w, h) {
    assertGray(gray);
    const { data, width: sw, height: sh } = gray;
    const out = new Float64Array(w * h);
    const sx = sw / w;
    const sy = sh / h;
    for (let ty = 0; ty < h; ty++) {
        const y0 = ty * sy;
        const y1 = y0 + sy;
        for (let tx = 0; tx < w; tx++) {
            const x0 = tx * sx;
            const x1 = x0 + sx;
            let sum = 0;
            let weight = 0;
            for (let y = Math.floor(y0); y < Math.min(Math.ceil(y1), sh); y++) {
                const wy = Math.min(y + 1, y1) - Math.max(y, y0);
                if (wy <= 0) continue;
                const row = y * sw;
                for (let x = Math.floor(x0); x < Math.min(Math.ceil(x1), sw); x++) {
                    const wx = Math.min(x + 1, x1) - Math.max(x, x0);
                    if (wx <= 0) continue;
                    const wgt = wx * wy;
                    sum += data[row + x] * wgt;
                    weight += wgt;
                }
            }
            out[ty * w + tx] = weight > 0 ? sum / weight : 0;
        }
    }
    return out;
}

function flipHorizontal(gray) {
    assertGray(gray);
    const { data, width, height } = gray;
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) out[row + x] = data[row + (width - 1 - x)];
    }
    return { data: out, width, height };
}

// Tabla de cosenos de la DCT-II de N puntos: COS[k * N + n] = cos(π/N · (n + ½) · k)
const COS = (() => {
    const N = PHASH_SIZE;
    const table = new Float64Array(N * N);
    for (let k = 0; k < N; k++) {
        for (let n = 0; n < N; n++) table[k * N + n] = Math.cos((Math.PI / N) * (n + 0.5) * k);
    }
    return table;
})();

// Solo hacen falta las primeras PHASH_BLOCK frecuencias en cada eje.
function dctLowBlock(pixels) {
    const N = PHASH_SIZE;
    const B = PHASH_BLOCK;
    // Filas: tmp[y][v] = Σx pixels[y][x] · cos(v, x)
    const tmp = new Float64Array(N * B);
    for (let y = 0; y < N; y++) {
        for (let v = 0; v < B; v++) {
            let s = 0;
            for (let x = 0; x < N; x++) s += pixels[y * N + x] * COS[v * N + x];
            tmp[y * B + v] = s;
        }
    }
    // Columnas: out[u][v] = Σy tmp[y][v] · cos(u, y)
    const out = new Float64Array(B * B);
    for (let u = 0; u < B; u++) {
        for (let v = 0; v < B; v++) {
            let s = 0;
            for (let y = 0; y < N; y++) s += tmp[y * B + v] * COS[u * N + y];
            out[u * B + v] = s;
        }
    }
    return out;
}

function bitsToHex(bits) {
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
        hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
    }
    return hex;
}

function median(values) {
    const sorted = Array.from(values).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function phash(gray) {
    const pixels = resizeArea(gray, PHASH_SIZE, PHASH_SIZE);
    const coeffs = dctLowBlock(pixels);
    const med = median(coeffs.subarray(1)); // sin el término DC
    const bits = new Array(64);
    for (let i = 0; i < 64; i++) bits[i] = coeffs[i] > med ? 1 : 0;
    return bitsToHex(bits);
}

function phashMirror(gray) {
    return phash(flipHorizontal(gray));
}

function dhash(gray) {
    const pixels = resizeArea(gray, 9, 8);
    const bits = new Array(64);
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) bits[y * 8 + x] = pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0;
    }
    return bitsToHex(bits);
}

function isHash(value) {
    return typeof value === 'string' && HEX_RE.test(value);
}

function hamming(hexA, hexB) {
    const a = String(hexA || '').toLowerCase();
    const b = String(hexB || '').toLowerCase();
    if (!isHash(a) || !isHash(b)) throw new TypeError('hamming: se esperan dos hashes hex de 16 caracteres');
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let count = 0;
    while (x) {
        x &= x - 1n;
        count += 1;
    }
    return count;
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Confianza de una coincidencia para soporte:
 * 'casi_segura' (distancia ≤ 2 o sha256 idéntico), 'posible' (3–8), null (> 8).
 */
function confidenceFor(distance, sameSha) {
    if (sameSha === true) return 'casi_segura';
    const d = Number(distance);
    if (!Number.isFinite(d) || d < 0) return null;
    if (d <= NEAR_CERTAIN_MAX) return 'casi_segura';
    if (d <= MATCH_THRESHOLD) return 'posible';
    return null;
}

// hex de 16 caracteres ⇄ literal de bit(64) de Postgres.
function hexToBitLiteral(hex) {
    const value = String(hex || '').toLowerCase();
    if (!isHash(value)) throw new TypeError('hexToBitLiteral: hash inválido');
    return `x${value}`;
}

function bitStringToHex(bits) {
    const value = String(bits || '');
    if (/^[01]{64}$/.test(value)) return bitsToHex(Array.from(value, (c) => (c === '1' ? 1 : 0)));
    if (isHash(value.toLowerCase())) return value.toLowerCase();
    return null;
}

module.exports = {
    phash,
    phashMirror,
    dhash,
    hamming,
    sha256,
    confidenceFor,
    isHash,
    hexToBitLiteral,
    bitStringToHex,
    MATCH_THRESHOLD,
    SEARCH_THRESHOLD,
    _internal: { resizeArea, flipHorizontal, dctLowBlock, median }
};
