'use strict';

// ===========================================================================
// Handles reservados para la URL corta del perfil (beta.weotzi.com/<handle>).
// ---------------------------------------------------------------------------
// La lista fija vive en public/shared/js/artist-public-url.js (la comparten el
// navegador y el servidor). Acá se le suman, en vivo, todas las entradas de
// public/: si mañana aparece public/turnos/, /turnos sigue siendo esa página
// aunque exista un artista turnos.wo (su enlace cae al alias largo).
// ===========================================================================

const fs = require('node:fs');
const path = require('node:path');
const PublicUrl = require('../public/shared/js/artist-public-url.js');

const CACHE_MS = 60 * 1000;
let cache = { dir: null, at: 0, set: null };

function publicEntries(publicDir) {
    try {
        return fs.readdirSync(publicDir).map((name) => name.replace(/\.[^.]+$/, '').toLowerCase());
    } catch (_) {
        return [];
    }
}

/** Set con los handles reservados (lista fija + entradas de public/). */
function reservedHandles(publicDir, now = Date.now()) {
    if (cache.set && cache.dir === publicDir && now - cache.at < CACHE_MS) return cache.set;
    const set = new Set(PublicUrl.RESERVED);
    for (const entry of publicEntries(publicDir)) set.add(entry);
    cache = { dir: publicDir, at: now, set };
    return set;
}

/** true si /<handle> ya es una página o archivo de public/. */
function existsInPublic(publicDir, handle) {
    const clean = String(handle || '').toLowerCase();
    if (!clean) return false;
    try {
        return fs.existsSync(path.join(publicDir, clean));
    } catch (_) {
        return true;
    }
}

function isReservedHandle(publicDir, handle) {
    const clean = String(handle || '').toLowerCase();
    return reservedHandles(publicDir).has(clean) || existsInPublic(publicDir, clean);
}

function resetCache() { cache = { dir: null, at: 0, set: null }; }

module.exports = { reservedHandles, isReservedHandle, existsInPublic, resetCache };
