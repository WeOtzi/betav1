/**
 * WE ÖTZI · Registro de cliente · "¿Qué tipo de tatuajes te gustan?" (ronda 2 · P31)
 * ----------------------------------------------------------------------------
 * "Añadir más estilos con sus fotos": la grilla del paso 03 pasa de 12 a los
 * 30 estilos principales del catálogo del registro (mismos nombres que eligen
 * los tatuadores → lib/registration-catalogs.js, grupo "principales"), cada
 * uno con su foto.
 *
 * Las fotos viven en /shared/assets/ronda2/registro/estilos/<slug>.webp y las
 * genera el orquestador (docs/plans/ronda2-assets/registro.json). Mientras un
 * archivo no exista, la tarjeta muestra una composición Bauhaus de respaldo.
 *
 * Módulo UMD: `names()` y `photoPath()` se prueban en tests/r2-registro.test.js.
 */
(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object' && root.document) root.WoClientStyles = api;
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    var ASSET_BASE = '/shared/assets/ronda2/registro/estilos/';

    // Mismo orden y etiquetas que el grupo "Estilos principales" del catálogo.
    var STYLES = [
        'Realismo', 'Hiperrealismo', 'Microrealismo', 'Fine Line', 'Blackwork', 'Black and Grey',
        'Tradicional Americano (Old School)', 'Neotradicional', 'Tradicional Japonés (Irezumi)', 'Neojaponés',
        'Tribal', 'Geométrico', 'Dotwork', 'Minimalista', 'Ornamental', 'Lettering', 'Caligrafía',
        'Acuarela (Watercolor)', 'Ilustrativo', 'Surrealismo', 'Abstracto', 'New School', 'Trash Polka',
        'Chicano', 'Biomecánico', 'Bioorgánico', 'Anime', 'Manga', 'Dark Art', 'Ignorant Style'
    ];
    // "Otro" cierra la lista (sin foto): quien no encuentra su estilo igual avanza.
    var OTHER = 'Otro';

    function slug(name) {
        return String(name == null ? '' : name)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/\([^)]*\)/g, ' ')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function names() {
        return STYLES.concat([OTHER]);
    }

    function basePath() {
        if (!root) return '';
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var pathname = (root.location && root.location.pathname) || '';
        return /^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '';
    }

    // Ruta pública de la foto de un estilo ('' si no lleva foto).
    function photoPath(name) {
        if (!name || name === OTHER || STYLES.indexOf(name) === -1) return '';
        return ASSET_BASE + slug(name) + '.webp';
    }

    // Suma la foto (o su respaldo) a una tarjeta .cw-style ya armada.
    function decorate(button, name, index) {
        if (!button || !root || !root.document) return;
        var grid = button.parentNode;
        if (grid && grid.classList) grid.classList.add('cw-styles--photos');
        var holder = root.document.createElement('span');
        holder.className = 'cw-style-photo';
        holder.setAttribute('aria-hidden', 'true');
        holder.setAttribute('data-tone', String((Number(index) || 0) % 4));
        var path = photoPath(name);
        if (path) {
            var img = root.document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', function () {
                img.remove();
                holder.classList.add('is-fallback');
            });
            img.src = basePath() + path;
            holder.appendChild(img);
        } else {
            holder.classList.add('is-fallback');
        }
        var nameEl = button.querySelector('.cw-style-name');
        button.insertBefore(holder, nameEl || button.firstChild);
    }

    return { ASSET_BASE: ASSET_BASE, STYLES: STYLES, OTHER: OTHER, slug: slug, names: names, photoPath: photoPath, decorate: decorate };
}));
