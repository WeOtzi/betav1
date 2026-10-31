'use strict';
/**
 * Rutas del flujo de artista retiradas al implementar el Figma final
 * ("We Otzi Pantallas final", oct 2026). Cada entrada redirige a la pantalla
 * que la reemplaza.
 *
 * La redirección solo se activa si la carpeta de la ruta ya no existe en
 * public/: restaurar la carpeta (git) vuelve a servir la página original sin
 * tocar este archivo. Lo usan server.js y el servidor de preview local.
 */
const fs = require('node:fs');
const path = require('node:path');

const LEGACY_ARTIST_ROUTES = {
    '/artist/profile/details': '/artist/account#perfil',
    // Galería pública: la ven clientes con ?artist=<u>; el query se conserva al redirigir.
    '/artist/profile/gallery': '/artist/profile',
    '/artist/visitors': '/my-quotations/statistics',
    // Las archivadas viven ahora como alcance del listado.
    '/archive': '/my-quotations?alcance=archivadas',
    // El recorrido guiado del modo demo reemplaza al tutorial estático.
    '/tutorial': '/my-quotations?demo=1&tour=1',
    // La landing comercial de tatuadores vive en el sitio corporativo (landing/).
    '/landing-tatuador': '/bienvenida'
};

function normalize(pathname) {
    const clean = String(pathname || '').replace(/\/index\.html$/i, '').replace(/\/+$/, '');
    return clean || '/';
}

/**
 * @param {string} pathname  ruta pedida (sin base path)
 * @param {string} publicDir carpeta public/ que se está sirviendo
 * @returns {string|null}    destino de la redirección o null
 */
function legacyRedirectFor(pathname, publicDir) {
    const key = normalize(pathname);
    const target = LEGACY_ARTIST_ROUTES[key];
    if (!target) return null;
    const stillThere = fs.existsSync(path.join(publicDir, key.slice(1), 'index.html'));
    return stillThere ? null : target;
}

/**
 * Arma el Location de la redirección: combina el query del destino con el de
 * la URL pedida (gana el pedido si se repite una clave) y conserva el hash.
 * @param {string} target       destino del mapa (puede traer ?query y #hash)
 * @param {string} search       query de la URL pedida ('' o '?a=b')
 * @param {object} [opts]       { prefix: base path, trailingSlash: bool }
 */
function legacyLocation(target, search, opts = {}) {
    const [beforeHash, hash] = String(target).split('#');
    const [targetPath, targetQuery] = beforeHash.split('?');
    const params = new URLSearchParams(targetQuery || '');
    new URLSearchParams(String(search || '').replace(/^\?/, '')).forEach((value, key) => params.set(key, value));
    const query = params.toString();
    const pathPart = (opts.prefix || '') + targetPath + (opts.trailingSlash && !targetPath.endsWith('/') ? '/' : '');
    return pathPart + (query ? '?' + query : '') + (hash ? '#' + hash : '');
}

module.exports = { LEGACY_ARTIST_ROUTES, legacyRedirectFor, legacyLocation };
