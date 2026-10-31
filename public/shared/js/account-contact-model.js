/**
 * WE OTZI - Datos de contacto del artista (Mi perfil · bloque "Contacto")
 * -----------------------------------------------------------------------
 * Lógica pura del WhatsApp y el email que el artista carga en el centro de
 * la cuenta (/artist/account#perfil). Sin DOM ni red: `window.WoAccountContact`
 * en el navegador y `require` en Node (tests/account-assisted.test.js).
 *
 * WhatsApp → artists_db.whatsapp_number en formato internacional (+ y 8 a 15
 * dígitos). El trigger trigger_sync_artist_to_auth copia ese número a
 * auth.users.phone, que es único: si otro usuario ya lo tiene, el UPDATE falla
 * con una violación de unicidad que se traduce con isDuplicatePhoneError().
 *
 * Email → es el correo de acceso (auth). Se cambia con auth.updateUser({ email })
 * y se aplica cuando el artista confirma el enlace; artists_db.email se
 * sincroniza después con el correo confirmado.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoAccountContact = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var WHATSAPP_RE = /^\+\d{8,15}$/;
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var MASK = '···';

    var MESSAGES = {
        whatsappFormat: 'Usá el formato internacional, por ejemplo +54 9 11 1234 5678',
        whatsappDuplicate: 'Ese WhatsApp ya está asociado a otra cuenta de We Ötzi.',
        emailInvalid: 'Ingresá un correo válido.'
    };

    // Saca espacios (también los no separables), guiones, puntos y paréntesis.
    // Conserva el + inicial. Vacío = sin número (se guarda null).
    // → { ok, value, empty, error }
    function normalizeWhatsapp(raw) {
        var text = String(raw == null ? '' : raw).trim();
        if (!text) return { ok: true, value: null, empty: true, error: null };
        var compact = text.replace(/[\s\-.()]/g, '');
        if (WHATSAPP_RE.test(compact)) return { ok: true, value: compact, empty: false, error: null };
        return { ok: false, value: compact, empty: false, error: MESSAGES.whatsappFormat };
    }

    function normalizeEmail(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    function isValidEmail(value) {
        var email = normalizeEmail(value);
        return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
    }

    function sameEmail(a, b) {
        return normalizeEmail(a) === normalizeEmail(b);
    }

    // "laura.tattoo@gmail.com" → "la···o@gmail.com". Vacío si no es un correo.
    function maskEmail(value) {
        var email = normalizeEmail(value);
        if (!isValidEmail(email)) return '';
        var at = email.lastIndexOf('@');
        var local = email.slice(0, at);
        var domain = email.slice(at);
        var shown;
        if (local.length <= 2) shown = local.charAt(0) + MASK;
        else if (local.length <= 4) shown = local.charAt(0) + MASK + local.charAt(local.length - 1);
        else shown = local.slice(0, 2) + MASK + local.charAt(local.length - 1);
        return shown + domain;
    }

    // Violación de unicidad de auth.users.phone (la dispara el trigger que
    // copia whatsapp_number). PostgREST la devuelve con code 23505 o con el
    // mensaje "duplicate key value violates unique constraint users_phone_key".
    function isDuplicatePhoneError(error) {
        if (!error) return false;
        var text = [error.code, error.message, error.details, error.hint]
            .filter(function (part) { return part != null; }).join(' ');
        if (!/phone/i.test(text)) return false;
        return /23505|duplicate|unique|already|exists/i.test(text);
    }

    return {
        MESSAGES: MESSAGES,
        normalizeWhatsapp: normalizeWhatsapp,
        normalizeEmail: normalizeEmail,
        isValidEmail: isValidEmail,
        sameEmail: sameEmail,
        maskEmail: maskEmail,
        isDuplicatePhoneError: isDuplicatePhoneError
    };
}));
