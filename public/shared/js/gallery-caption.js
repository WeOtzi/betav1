/* ============================================================================
   WE ÖTZI — Pie de foto del portfolio (ronda 2 · frente "registro")
   ----------------------------------------------------------------------------
   Cada ítem de la galería del artista (artists_db.gallery_feed_items) y del
   estudio (studios.photo_feed_items) puede llevar un campo de texto `caption`:
     · importado de Instagram → llega con el pie de la publicación;
     · subido desde el dispositivo → lo escribe el artista (registro o panel).

   Contrato entre frentes: `caption` es TEXTO PLANO (sin HTML), de hasta
   CAPTION_MAX caracteres. Quien lo muestre (perfil público, panel) lo escapa.
   La misma limpieza la aplica la base con el trigger de la migración
   20261116200000_gallery_caption_guard.sql.

   Módulo UMD: lo usan el navegador (window.WoGalleryCaption) y el servidor
   (lib/instagram-import.js). Sin dependencias.
   ============================================================================ */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object') root.WoGalleryCaption = api;
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    // Mismo tope que Instagram: un pie importado entra completo.
    var CAPTION_MAX = 2200;

    // Controles C0/C1 (menos el salto de línea), DEL y marcas bidi que permiten
    // "dar vuelta" el texto visible. No se toca U+200D: arma emojis compuestos.
    var CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩﻿]/g;

    function sanitizeCaption(value, max) {
        if (typeof value !== 'string') return '';
        var limit = typeof max === 'number' && max > 0 ? Math.min(max, CAPTION_MAX) : CAPTION_MAX;
        var text = value
            .replace(/\r\n?/g, '\n')
            .replace(/\t/g, ' ')
            .replace(CONTROL_RE, '')
            .replace(/[  ]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (!text) return '';
        // Corte por puntos de código: nunca parte un emoji por la mitad.
        var points = Array.from(text);
        if (points.length > limit) text = points.slice(0, limit).join('').trim();
        return text;
    }

    function captionLength(value) {
        return Array.from(typeof value === 'string' ? value : '').length;
    }

    // Aplica un pie a un ítem del feed sin mutarlo. Vacío → quita el campo.
    function withCaption(item, value) {
        var out = Object.assign({}, item || {});
        var clean = sanitizeCaption(value);
        if (clean) out.caption = clean; else delete out.caption;
        return out;
    }

    // Limpia el pie de cada ítem de un feed (lo que no es texto se descarta).
    function normalizeFeedCaptions(items) {
        if (!Array.isArray(items)) return [];
        return items.map(function (item) {
            if (!item || typeof item !== 'object' || !('caption' in item)) return item;
            return withCaption(item, item.caption);
        });
    }

    // Mapa { permalink: pie } que el registro manda al commit de Instagram:
    // solo claves/valores de texto, hasta `maxEntries` entradas.
    function sanitizeCaptionMap(map, maxEntries) {
        var out = {};
        if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
        var limit = typeof maxEntries === 'number' && maxEntries > 0 ? maxEntries : 50;
        var count = 0;
        Object.keys(map).some(function (key) {
            if (count >= limit) return true;
            if (typeof key !== 'string' || !key || key.length > 300 || typeof map[key] !== 'string') return false;
            // '' es válido: el artista borró el pie que venía de Instagram.
            out[key] = sanitizeCaption(map[key]);
            count += 1;
            return false;
        });
        return out;
    }

    return {
        CAPTION_MAX: CAPTION_MAX,
        sanitizeCaption: sanitizeCaption,
        captionLength: captionLength,
        withCaption: withCaption,
        normalizeFeedCaptions: normalizeFeedCaptions,
        sanitizeCaptionMap: sanitizeCaptionMap
    };
}));
