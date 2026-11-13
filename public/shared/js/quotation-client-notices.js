/**
 * WE OTZI - Avisos al cliente por acciones del artista (ronda 3 · P8)
 * ------------------------------------------------------------------
 * Cuando el artista rechaza/cancela, marca "listo para cliente" o responde
 * una disputa, el cliente recibe:
 *   - el aviso in-app: el feed "Tu actividad" del panel del cliente lo deriva
 *     del historial de estados y de quotation_disputes (client-dashboard.js);
 *   - un email por el dispatcher existente POST /api/email/:eventId. El
 *     servidor resuelve destinatario y estado desde la cotización guardada
 *     (services/email-request-context.js): el navegador solo dice qué pasó.
 * El envío es silencioso: si el canal de correo no está configurado, la
 * acción del artista ya quedó guardada y no se muestra un error.
 *
 * Navegador: window.QuotationClientNotices. Node (tests): require().
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.QuotationClientNotices = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Estado nuevo de la cotización → evento de email para el cliente.
    var STATUS_EVENTS = {
        cancelled: 'artist_rejected_quotation',
        artist_completed: 'quotation_ready_for_client'
    };

    function eventForStatus(nextStatus, previousStatus) {
        if (!nextStatus || nextStatus === previousStatus) return null;
        return STATUS_EVENTS[nextStatus] || null;
    }

    function basePath() {
        if (typeof window === 'undefined') return '';
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        var path = (window.location && window.location.pathname) || '';
        return path === '/beta' || path.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    function isPreview() {
        return typeof window !== 'undefined'
            && (window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled));
    }

    async function accessToken() {
        try {
            var client = (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient())
                || window._supabase;
            if (!client || !client.auth) return null;
            var res = await client.auth.getSession();
            return (res && res.data && res.data.session && res.data.session.access_token) || null;
        } catch (_) {
            return null;
        }
    }

    /** Envía el aviso. Nunca lanza: devuelve { ok, skipped?, error? }. */
    async function send(eventId, payload) {
        if (!eventId) return { ok: false, skipped: true };
        if (isPreview()) return { ok: true, skipped: true, preview: true };
        try {
            var token = await accessToken();
            if (!token) return { ok: false, skipped: true, error: 'sin sesión' };
            var response = await fetch(basePath() + '/api/email/' + encodeURIComponent(eventId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ data: payload || {} })
            });
            var body = null;
            try { body = await response.json(); } catch (_) { /* sin cuerpo */ }
            var ok = response.ok && !(body && body.success === false);
            if (!ok) console.warn('[client-notices] ' + eventId + ':', (body && body.error) || response.status);
            return { ok: ok, status: response.status };
        } catch (error) {
            console.warn('[client-notices] ' + eventId + ':', error && error.message);
            return { ok: false, error: error && error.message };
        }
    }

    /** Aviso por cambio de estado (rechazo/cancelación, entrega lista). */
    function notifyStatusChange(quote, nextStatus, previousStatus) {
        var eventId = eventForStatus(nextStatus, previousStatus);
        if (!eventId || !quote || !quote.quote_id) return Promise.resolve({ ok: false, skipped: true });
        return send(eventId, { quote_id: quote.quote_id });
    }

    /** Aviso de respuesta a una disputa (al cliente y a soporte). */
    function notifyDisputeResponse(quote, disputeId) {
        if (!quote || !quote.quote_id || disputeId == null) return Promise.resolve({ ok: false, skipped: true });
        return send('dispute_artist_response', { quote_id: quote.quote_id, dispute_id: disputeId });
    }

    return {
        STATUS_EVENTS: STATUS_EVENTS,
        eventForStatus: eventForStatus,
        send: send,
        notifyStatusChange: notifyStatusChange,
        notifyDisputeResponse: notifyDisputeResponse
    };
}));
