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
    '/artist/profile/gallery': '/artist/account#portafolio',
    '/artist/visitors': '/my-quotations/statistics',
    '/archive': '/my-quotations',
    '/tutorial': '/my-quotations',
    '/landing-tatuador': '/bienvenida',
    '/quotations': '/my-quotations'
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

module.exports = { LEGACY_ARTIST_ROUTES, legacyRedirectFor };
