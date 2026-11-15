/**
 * WE OTZI - Matriz de notificaciones del cliente (ronda 2 · frente cliente-panel)
 * ----------------------------------------------------------------------------
 * Espejo en el navegador de las reglas de lib/notification-prefs.js para el
 * CLIENTE (CLIENT_NOTIF_DEFAULTS + resolvePreference):
 *   user_preferences.notification_prefs = { <evento>: { email, push, sms } }
 *   - elección explícita por evento/canal (booleano) → manda siempre;
 *   - si no hay, vale el "Email" del registro (formato plano previo a la
 *     matriz: email_updates === false apaga los correos);
 *   - si tampoco, el valor por defecto del servidor.
 * Los valores por defecto llegan de GET /api/client/panel/notification-matrix
 * (misma fuente que usa el envío); FALLBACK_DEFAULTS solo cubre el caso de que
 * ese pedido falle.
 *
 * Cada cambio escribe SOLO el evento tocado: lo que el cliente nunca eligió
 * sigue el valor por defecto del servidor aunque cambie después.
 *
 * Sin DOM ni red. Expone window.WoClientNotif (o module.exports en Node).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WoClientNotif = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canales que el cliente puede configurar (el SMS no se ofrece al cliente).
    var CHANNELS = ['email', 'push'];
    var CHANNEL_LABELS = { email: 'Email', push: 'Push' };

    var KINDS = [
        { key: 'postulaciones', label: 'Postulaciones', help: 'Cuando un artista se postula a una idea que publicaste en el job board.' },
        { key: 'mensajes', label: 'Mensajes', help: 'Cuando un artista te escribe por una cotización.' },
        { key: 'cotizaciones', label: 'Cotizaciones', help: 'Cuando una cotización tuya cambia de estado.' }
    ];

    var FALLBACK_DEFAULTS = {
        postulaciones: { email: true, push: false },
        mensajes: { email: true, push: false },
        cotizaciones: { email: true, push: false }
    };

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function humanize(key) {
        var text = String(key || '').replace(/[_-]+/g, ' ').trim();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
    }

    // Respuesta del servidor ({ kinds: [{ key, defaults }] }) o mapa plano
    // { kind: { email, push } } → mapa completo. Lo desconocido se ignora.
    function normalizeDefaults(input) {
        var out = {};
        Object.keys(FALLBACK_DEFAULTS).forEach(function (k) { out[k] = Object.assign({}, FALLBACK_DEFAULTS[k]); });
        var source = input && Array.isArray(input.kinds)
            ? input.kinds.reduce(function (acc, row) { if (row && row.key) acc[row.key] = row.defaults; return acc; }, {})
            : input;
        if (!isPlainObject(source)) return out;
        Object.keys(source).forEach(function (k) {
            if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || !isPlainObject(source[k])) return;
            var row = out[k] || { email: true, push: false };
            CHANNELS.forEach(function (ch) { if (typeof source[k][ch] === 'boolean') row[ch] = source[k][ch]; });
            out[k] = row;
        });
        return out;
    }

    /** ¿Está prendido este aviso? Misma decisión que el servidor al enviar. */
    function effective(prefs, kind, channel, defaults) {
        var map = defaults || FALLBACK_DEFAULTS;
        if (!map[kind] || CHANNELS.indexOf(channel) === -1) return true;
        var saved = isPlainObject(prefs) && isPlainObject(prefs[kind]) ? prefs[kind] : null;
        if (saved && typeof saved[channel] === 'boolean') return saved[channel];
        if (channel === 'email' && isPlainObject(prefs) && prefs.email_updates === false) return false;
        return map[kind][channel] === true;
    }

    /** Filas listas para pintar: [{ key, label, help, email, push }]. */
    function matrix(prefs, defaults) {
        var map = defaults || FALLBACK_DEFAULTS;
        var known = KINDS.filter(function (k) { return !!map[k.key]; });
        var extra = Object.keys(map)
            .filter(function (key) { return !KINDS.some(function (k) { return k.key === key; }); })
            .map(function (key) { return { key: key, label: humanize(key), help: '' }; });
        return known.concat(extra).map(function (k) {
            var row = { key: k.key, label: k.label, help: k.help };
            CHANNELS.forEach(function (ch) { row[ch] = effective(prefs, k.key, ch, map); });
            return row;
        });
    }

    /**
     * Parche para Prefs.saveSection('notification_prefs', …) al tocar UN toggle:
     * solo el evento cambiado, conservando lo que ya había elegido en ese evento.
     */
    function patchFor(prefs, kind, channel, value) {
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(String(kind || '')) || CHANNELS.indexOf(channel) === -1) return null;
        var saved = isPlainObject(prefs) && isPlainObject(prefs[kind]) ? prefs[kind] : {};
        var next = {};
        ['email', 'push', 'sms'].forEach(function (ch) { if (typeof saved[ch] === 'boolean') next[ch] = saved[ch]; });
        next[channel] = !!value;
        var patch = {};
        patch[kind] = next;
        return patch;
    }

    return {
        CHANNELS: CHANNELS,
        CHANNEL_LABELS: CHANNEL_LABELS,
        KINDS: KINDS,
        FALLBACK_DEFAULTS: FALLBACK_DEFAULTS,
        normalizeDefaults: normalizeDefaults,
        effective: effective,
        matrix: matrix,
        patchFor: patchFor
    };
}));
