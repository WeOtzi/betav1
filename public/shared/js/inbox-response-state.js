/**
 * Estado de respuesta de un hilo del Inbox del artista (Figma 801:1085).
 *
 * "Esperando respuesta" significa que la otra parte escribió y el artista
 * todavía no contestó. Un mensaje de sistema que CIERRA la acción (invitación
 * aceptada o rechazada, postulación aceptada o descartada) no espera nada del
 * artista: antes figuraba como "Esperando respuesta" porque el último mensaje
 * no era suyo (auditoría H8). Lógica pura, testeable en Node.
 */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.InboxResponseState = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const REPLIED = Object.freeze({ key: 'replied', label: 'Respondido', cls: 'is-replied' });
    const WAITING = Object.freeze({ key: 'waiting', label: 'Esperando respuesta', cls: 'is-waiting' });
    const CLOSED = Object.freeze({ key: 'closed', label: 'Cerrado', cls: 'is-closed' });

    // Estados de dominio (context jsonb del hilo) en los que no queda nada
    // pendiente del lado del artista.
    const RESOLVED_STATUSES = new Set([
        'active', 'accepted', 'rejected', 'declined', 'ended', 'cancelled', 'canceled',
        'withdrawn', 'expired', 'completed', 'aceptada', 'rechazada', 'cancelada', 'finalizada',
    ]);

    function contextStatus(context) {
        const ctx = context && typeof context === 'object' ? context : {};
        const value = ctx.membership_status || ctx.application_status || ctx.invitation_status
            || ctx.request_status || ctx.status || '';
        return String(value).trim().toLowerCase();
    }

    /**
     * @param {object} row  fila adaptada del Inbox ({ closed, context, lastSenderUserId, lastSenderRole })
     * @param {string} userId  usuario del artista en sesión
     */
    function responseState(row, userId) {
        const item = row || {};
        if (item.closed) return CLOSED;
        const explicit = item.context && item.context.reply_status;
        if (explicit === 'replied') return REPLIED;
        if (explicit === 'waiting') return WAITING;
        if (userId && item.lastSenderUserId === userId) return REPLIED;
        // En inbox_messages los mensajes de sistema no tienen sender_user_id, así
        // que el hilo unificado queda con last_sender_user_id nulo.
        const fromSystem = !item.lastSenderUserId && item.lastSenderRole === 'system';
        if (fromSystem && RESOLVED_STATUSES.has(contextStatus(item.context))) return REPLIED;
        return WAITING;
    }

    return { responseState, contextStatus, RESOLVED_STATUSES };
}));
