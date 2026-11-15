'use strict';

// ===========================================================================
// Lógica pura del frente cliente-panel (ronda 2).
// ---------------------------------------------------------------------------
// La matriz de notificaciones del cliente (/client/profile#notificaciones) se
// pinta con los MISMOS eventos y valores por defecto que usa el envío
// (lib/notification-prefs.js · CLIENT_NOTIF_DEFAULTS): el navegador no los
// repite, los pide a GET /api/client/panel/notification-matrix. Así, si otro
// frente cambia un valor por defecto o suma un evento, el toggle del cliente
// muestra lo que el servidor realmente hace.
// ===========================================================================

// Canales que el cliente puede configurar. El SMS no se ofrece al cliente.
const CLIENT_MATRIX_CHANNELS = Object.freeze(['email', 'push']);

const KIND_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * @param {{ CLIENT_NOTIF_DEFAULTS?: object }} prefsModule  lib/notification-prefs.js
 * @returns {{ role: 'client', channels: string[], kinds: Array<{ key: string, defaults: object }> }}
 */
function clientNotificationMatrix(prefsModule) {
    const defaults = (prefsModule && prefsModule.CLIENT_NOTIF_DEFAULTS) || {};
    const kinds = Object.keys(defaults)
        .filter((key) => KIND_PATTERN.test(key) && defaults[key] && typeof defaults[key] === 'object')
        .map((key) => ({
            key,
            defaults: CLIENT_MATRIX_CHANNELS.reduce((acc, channel) => {
                acc[channel] = defaults[key][channel] === true;
                return acc;
            }, {})
        }));
    return { role: 'client', channels: CLIENT_MATRIX_CHANNELS.slice(), kinds };
}

module.exports = { CLIENT_MATRIX_CHANNELS, clientNotificationMatrix };
