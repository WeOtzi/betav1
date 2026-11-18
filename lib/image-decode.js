'use strict';

// ===========================================================================
// Decodificación de imágenes para las huellas (adaptador de sharp).
// ---------------------------------------------------------------------------
// `sharp` NO está declarado en package.json todavía (la decisión está
// pendiente de la auditoría de dependencias). Por eso se carga de forma
// perezosa y tolerante: si `require('sharp')` falla, isAvailable() es false,
// fingerprintBuffer() rechaza con un error 503 claro, y el trabajo de huellas
// y el buscador se apagan con un aviso, sin romper el servidor.
//
//   isAvailable() → boolean
//   fingerprintBuffer(buffer) → { sha256, phash, phash_mirror, dhash, width, height }
//
// Límites: 10 MB por archivo, 40 Mpx de entrada, 15 s por imagen. Solo JPEG,
// PNG y WebP: al cargar sharp se bloquean en libvips todos los demás
// cargadores (SVG, PDF, HEIF/AVIF, TIFF, GIF, VIPS, JP2, JXL, RAW, Magick…).
// El HEIC del iPhone lo convierte el buscador en el navegador.
//
// Endurecimiento (docs/plans/2026-11-18-auditoria-sharp.md §5): cache(false),
// concurrency(1), failOn 'error', limitInputPixels, sequentialRead, una sola
// página y sin animación, y el timeout propio de sharp para que libvips se
// detenga de verdad. Ojo: block/cache/concurrency son globales del proceso;
// hoy este es el único módulo que usa sharp.
// ===========================================================================

const FP = require('./image-fingerprint');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40e6;
const DECODE_TIMEOUT_MS = 15000;
const WORK_SIZE = 64;

const UNAVAILABLE_MESSAGE = 'El análisis de imágenes no está disponible por ahora. Intenta más tarde.';

// Cargadores de libvips permitidos; todo otro VipsForeignLoad* queda bloqueado.
const ALLOWED_LOADERS = ['VipsForeignLoadJpeg', 'VipsForeignLoadPng', 'VipsForeignLoadWebp'];

let sharpLib;
let loaded = false;

// Configuración global de sharp, una vez por módulo cargado. Cada llamada va
// protegida: un sharp falso (tests) o una versión sin el método no rompe nada.
function hardenSharp(sharp) {
    if (typeof sharp !== 'function') return;
    const call = (name, ...args) => {
        if (typeof sharp[name] !== 'function') return;
        try { sharp[name](...args); } catch (err) {
            console.warn(`[image-decode] sharp.${name} no se pudo aplicar:`, err && err.message);
        }
    };
    call('cache', false);
    call('concurrency', 1);
    call('block', { operation: ['VipsForeignLoad'] });
    call('unblock', { operation: ALLOWED_LOADERS });
}

function loadSharp() {
    if (!loaded) {
        loaded = true;
        try {
            // eslint-disable-next-line global-require
            sharpLib = require('sharp');
        } catch (_) {
            sharpLib = null;
        }
        hardenSharp(sharpLib);
    }
    return sharpLib;
}

function isAvailable() {
    return typeof loadSharp() === 'function';
}

function decodeError(code, message, status) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
}

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(decodeError('DECODE_TIMEOUT', 'La imagen tardó demasiado en procesarse.', 422)), ms);
        if (timer && typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Orientaciones EXIF 5–8 rotan 90°: el ancho y el alto se intercambian.
function orientedSize(meta) {
    const w = Number(meta && meta.width) || null;
    const h = Number(meta && meta.height) || null;
    if (meta && Number(meta.orientation) >= 5) return { width: h, height: w };
    return { width: w, height: h };
}

const SHARP_OPTIONS = Object.freeze({
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
    animated: false,
    pages: 1
});

// Timeout de libvips (además del Promise.race): corta el trabajo nativo.
function withSharpTimeout(instance) {
    if (instance && typeof instance.timeout === 'function') {
        return instance.timeout({ seconds: Math.ceil(DECODE_TIMEOUT_MS / 1000) });
    }
    return instance;
}

async function decodeGray(sharp, buffer) {
    const opts = { ...SHARP_OPTIONS };
    const meta = await sharp(buffer, opts).metadata();
    const { data, info } = await withSharpTimeout(sharp(buffer, opts))
        .rotate()
        .flatten({ background: '#ffffff' })
        .greyscale()
        .resize(WORK_SIZE, WORK_SIZE, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const channels = Number(info && info.channels) || 1;
    const width = Number(info && info.width) || WORK_SIZE;
    const height = Number(info && info.height) || WORK_SIZE;
    let gray = data;
    if (channels > 1) {
        gray = new Uint8Array(width * height);
        for (let i = 0; i < gray.length; i++) gray[i] = data[i * channels];
    }
    return { gray: { data: gray, width, height }, size: orientedSize(meta) };
}

async function fingerprintBuffer(buffer, { timeoutMs = DECODE_TIMEOUT_MS } = {}) {
    const sharp = loadSharp();
    if (typeof sharp !== 'function') throw decodeError('DECODER_UNAVAILABLE', UNAVAILABLE_MESSAGE, 503);
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
        throw decodeError('INVALID_IMAGE', 'No recibimos una imagen.', 400);
    }
    if (buffer.length === 0) throw decodeError('INVALID_IMAGE', 'No recibimos una imagen.', 400);
    if (buffer.length > MAX_BYTES) throw decodeError('IMAGE_TOO_LARGE', 'La imagen supera los 10 MB.', 413);
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.length);

    let decoded;
    try {
        decoded = await withTimeout(decodeGray(sharp, buf), timeoutMs);
    } catch (err) {
        if (err && err.code === 'DECODE_TIMEOUT') throw err;
        throw decodeError('DECODE_FAILED', 'No pudimos leer la imagen. Prueba con un JPG, PNG o WebP.', 422);
    }
    return {
        sha256: FP.sha256(buf),
        phash: FP.phash(decoded.gray),
        phash_mirror: FP.phashMirror(decoded.gray),
        dhash: FP.dhash(decoded.gray),
        width: decoded.size.width,
        height: decoded.size.height
    };
}

// Solo tests: reemplaza el módulo de sharp (null = no instalado).
function _setSharpForTests(mod) {
    loaded = true;
    sharpLib = mod;
    hardenSharp(mod);
}

function _resetForTests() {
    loaded = false;
    sharpLib = undefined;
}

module.exports = {
    isAvailable,
    fingerprintBuffer,
    MAX_BYTES,
    MAX_INPUT_PIXELS,
    ALLOWED_LOADERS,
    DECODE_TIMEOUT_MS,
    UNAVAILABLE_MESSAGE,
    _setSharpForTests,
    _resetForTests
};
