/**
 * WE OTZI - Insignia de verificado
 * --------------------------------
 * La insignia exige dos cosas (plan KYC 1.5):
 *   - artista: verification_state === 'Yes'; estudio: is_verified === true;
 *   - y que controle su Instagram: el Instagram del perfil es el mismo que se
 *     validó con el código (o que confirmó soporte).
 * Si el artista o el estudio cambia su Instagram, la insignia se oculta hasta
 * que valide el nuevo.
 *
 * 2.7.0 (sanciones): un perfil sancionado nunca muestra la insignia. Estudio:
 * además de is_verified, tiene que estar público (is_active distinto de false
 * y sanction_state 'none' o ausente: el navegador no lee sanction_state, pero
 * la sanción también apaga is_active). Artista: sanction_state 'none' o
 * ausente (la RLS ya oculta a los sancionados).
 *
 * La regla de Instagram está en la base como columna generada
 * `instagram_badge_ok` (artists_db y studios, migración 20261118100000). El
 * navegador no puede leer `instagram_verified_handle`, así que la columna
 * manda cuando viene en la fila. Sin la columna (servidor con service role o
 * filas viejas) se compara el handle con la misma normalización que
 * services/instagram-verification.js (normalizeHandle).
 *
 * Módulo puro (sin DOM): `window.WoVerifiedBadge` en el navegador y `require`
 * en Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoVerifiedBadge = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
    var URL_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)/i;

    // Acepta "laura", "@Laura.Tattoo" o la URL del perfil. Devuelve el usuario
    // en minúsculas o null si no es válido (copia de normalizeHandle del
    // servidor y de public.instagram_badge_ok_for en SQL).
    function normalizeHandle(value) {
        var s = String(value == null ? '' : value).trim();
        var fromUrl = URL_RE.exec(s);
        if (fromUrl) s = fromUrl[1];
        s = s.replace(/^@+/, '');
        return HANDLE_RE.test(s) ? s.toLowerCase() : null;
    }

    // ¿El Instagram del perfil es el validado?
    function instagramMatches(row) {
        if (!row || typeof row !== 'object') return false;
        if (typeof row.instagram_badge_ok === 'boolean') return row.instagram_badge_ok;
        if (!row.instagram_verified_at) return false;
        var current = normalizeHandle(row.instagram);
        if (!current) return false;
        return current === normalizeHandle(row.instagram_verified_handle);
    }

    // sanction_state ausente (sin la columna o sin permiso) cuenta como 'none'.
    function sanctionClear(row) {
        var state = row ? row.sanction_state : null;
        return state == null || state === '' || state === 'none';
    }

    // Estudio visible en lo público: activo y sin sanción. Una sanción de
    // estudio (suspensión o baneo del dueño) fija sanction_state y apaga
    // is_active (lib/sanciones-service.js, paso profile).
    function isStudioPublic(row) {
        return Boolean(row) && typeof row === 'object' && row.is_active !== false && sanctionClear(row);
    }

    function isArtistVerified(row) {
        return Boolean(row) && row.verification_state === 'Yes';
    }

    function isStudioVerified(row) {
        return Boolean(row) && row.is_verified === true;
    }

    function isBadgeVisible(artist) {
        return isArtistVerified(artist) && sanctionClear(artist) && instagramMatches(artist);
    }

    function isStudioBadgeVisible(studio) {
        return isStudioVerified(studio) && isStudioPublic(studio) && instagramMatches(studio);
    }

    // Para la cuenta y soporte: 'visible' | 'hidden_ig_changed' | 'not_verified'.
    // Sirve para artistas (verification_state) y estudios (is_verified).
    function badgeState(row) {
        var verified = isArtistVerified(row) || isStudioVerified(row);
        if (!verified) return 'not_verified';
        return instagramMatches(row) ? 'visible' : 'hidden_ig_changed';
    }

    return {
        normalizeHandle: normalizeHandle,
        instagramMatches: instagramMatches,
        isBadgeVisible: isBadgeVisible,
        isStudioBadgeVisible: isStudioBadgeVisible,
        isStudioPublic: isStudioPublic,
        badgeState: badgeState
    };
}));
