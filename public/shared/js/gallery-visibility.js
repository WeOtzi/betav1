/**
 * WE OTZI - Visibilidad pública de la galería del artista
 * -------------------------------------------------------
 * Las fotos importadas desde Instagram quedan ocultas para los demás hasta
 * que el artista valida su cuenta de Instagram (código por email + mensaje
 * directo a @weotzi). Esta regla vive en un solo lugar y se usa en:
 *   - el perfil público (artist-profile.js), que filtra lo que ve el cliente;
 *   - el centro de la cuenta y el dashboard, que marcan "pendiente" lo que el
 *     artista ve pero los clientes todavía no;
 *   - el servidor (services/instagram-verification.js), que cuenta pendientes.
 * La misma regla está espejada en SQL (migración 20261030120000) para la
 * columna derivada gallery_images.
 *
 * Estado de validación (`state`):
 *   { enforced: boolean, verified: boolean, handle: string|null }
 * `enforced` es false cuando el backend todavía no tiene la validación (la
 * migración no está aplicada): en ese caso todo se muestra como hasta ahora.
 *
 * Módulo puro (sin DOM): `window.WoGalleryVisibility` en el navegador y
 * `require` en Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoGalleryVisibility = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var IG_CATEGORIES = { instagram: true, 'instagram-reel': true };

    function normalizeHandle(value) {
        return String(value == null ? '' : value).trim().replace(/^@+/, '').toLowerCase();
    }

    // Un ítem viene de Instagram si lo marcó el import (source), si conserva
    // el permalink de Instagram, si su archivo vive en la carpeta del import
    // o si todavía tiene la categoría original del import.
    function isInstagramItem(item) {
        if (!item || typeof item !== 'object') return false;
        if (String(item.source || '').toLowerCase() === 'instagram') return true;
        if (/instagram\.com\//i.test(String(item.permalink || ''))) return true;
        if (String(item.url || '').indexOf('/instagram-import/') !== -1) return true;
        return Boolean(IG_CATEGORIES[String(item.category || '').toLowerCase()]);
    }

    function isEnforced(state) {
        return Boolean(state && state.enforced === true);
    }

    // Un ítem de Instagram se publica cuando la cuenta está validada y, si el
    // ítem sabe de qué cuenta vino, esa cuenta es la validada. Los ítems
    // importados antes de esta regla (ig_legacy) se conservan visibles.
    function isPubliclyVisible(item, state) {
        if (!isInstagramItem(item)) return true;
        if (item.ig_legacy === true) return true;
        if (!isEnforced(state)) return true;
        if (!state.verified) return false;
        var itemHandle = normalizeHandle(item.ig_handle);
        if (!itemHandle) return true;
        return itemHandle === normalizeHandle(state.handle);
    }

    function isPendingValidation(item, state) {
        return isInstagramItem(item) && !isPubliclyVisible(item, state);
    }

    function filterPublic(items, state) {
        return (Array.isArray(items) ? items : []).filter(function (item) {
            return isPubliclyVisible(item, state);
        });
    }

    function pendingCount(items, state) {
        return (Array.isArray(items) ? items : []).filter(function (item) {
            return isPendingValidation(item, state);
        }).length;
    }

    // Normaliza la respuesta del RPC público o del endpoint del artista al
    // contrato { enforced, verified, handle }. En el endpoint del artista
    // `handle` es el usuario cargado hoy en el perfil y `verified_handle` el
    // que se validó: manda el validado (en el RPC `handle` ya es el validado).
    function stateFrom(source) {
        if (!source || typeof source !== 'object') return { enforced: false, verified: false, handle: null };
        var verified = source.verified === true || Boolean(source.verified_at);
        return {
            enforced: source.enforced === true,
            verified: verified,
            handle: normalizeHandle(source.verified_handle || source.handle) || null
        };
    }

    return {
        normalizeHandle: normalizeHandle,
        isInstagramItem: isInstagramItem,
        isPubliclyVisible: isPubliclyVisible,
        isPendingValidation: isPendingValidation,
        filterPublic: filterPublic,
        pendingCount: pendingCount,
        stateFrom: stateFrom
    };
}));
