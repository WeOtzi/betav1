// ============================================
// WE ÖTZI - EMAIL CLIENT (frontend)
// Thin wrapper around POST /api/email/:eventId.
// All transactional/notification emails MUST go through this module — never call
// n8n webhooks directly from new code.
// ============================================
//
// Usage:
//     await EmailClient.sendEmail('artist_registration_completed', {
//         email: '...', username: '...', password: '...', name: '...', ...
//     });
//
// Backend routes the event to n8n / BillionMail / dual / off based on the
// per-event feature flag stored in app_settings.email_routing.
//
// Backwards compatibility:
// - ConfigManager.sendN8NEvent(eventId, payload) is kept and now delegates
//   internally to EmailClient.sendEmail. Existing call sites keep working
//   unchanged but now respect the new routing flag.
//
// This file is loaded as a plain <script> (no modules) and exposes window.EmailClient.

(function () {
    'use strict';

    const DEFAULT_TIMEOUT_MS = 15000;
    const ENDPOINT_BASE = '/api/email';

    function _dbg() {
        try {
            if (typeof window !== 'undefined' && window.__WEOTZI_DEBUG) {
                console.log.apply(console, ['[EmailClient]'].concat([].slice.call(arguments)));
            }
        } catch (_) {}
    }

    async function _authHeaders() {
        try {
            const client = window.__backofficeGuardClient
                || (window.ConfigManager && typeof window.ConfigManager.getSupabaseClient === 'function'
                    ? window.ConfigManager.getSupabaseClient()
                    : null);
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return {};
            const { data } = await client.auth.getSession();
            const token = data && data.session && data.session.access_token;
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch (_) {
            return {};
        }
    }

    /**
     * Dispatch an email event through the backend.
     * @param {string} eventId
     * @param {Object} payload  Free-form data; backend transforms into BillionMail attribs
     *                          and/or n8n webhook body depending on routing flag.
     * @param {Object} [options]
     * @param {number} [options.timeoutMs]
     * @param {AbortSignal} [options.signal]
     * @returns {Promise<{success: boolean, channel?: string, error?: string, ...}>}
     */
    async function sendEmail(eventId, payload, options) {
        if (!eventId || typeof eventId !== 'string') {
            return { success: false, error: 'eventId required' };
        }

        const opts = options || {};
        const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

        // Combine an internal abort timer with any caller-supplied signal.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        if (opts.signal) {
            try { opts.signal.addEventListener('abort', () => controller.abort()); } catch (_) {}
        }

        try {
            _dbg('dispatch', eventId);
            const requestBody = JSON.stringify({ data: payload || {} });
            const useKeepalive = !!opts.keepalive && requestBody.length <= 60000;
            if (opts.keepalive && !useKeepalive) {
                _dbg('keepalive skipped: payload too large', eventId, requestBody.length);
            }

            const res = await fetch(`${ENDPOINT_BASE}/${encodeURIComponent(eventId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody,
                signal: controller.signal,
                keepalive: useKeepalive
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                _dbg('failed', eventId, res.status, body);
                return { success: false, status: res.status, error: body.error || `HTTP ${res.status}`, ...body };
            }
            _dbg('ok', eventId, body.channel);
            return { success: true, ...body };
        } catch (err) {
            _dbg('error', eventId, err && err.message);
            return { success: false, error: (err && err.message) || 'Unknown error' };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Send a synthetic test email (admin / QA).
     */
    async function sendTest(eventId, recipient, channel) {
        try {
            const res = await fetch(`${ENDPOINT_BASE}/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
                body: JSON.stringify({ eventId, recipient, channel })
            });
            const body = await res.json().catch(() => ({}));
            return body;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * List all events with their current routing channel.
     */
    async function listEvents() {
        try {
            const res = await fetch(`${ENDPOINT_BASE}/events`, {
                headers: await _authHeaders()
            });
            const body = await res.json().catch(() => ({}));
            return body;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Update routing for one event (admin only).
     */
    async function updateEvent(eventId, updates) {
        try {
            const res = await fetch(`${ENDPOINT_BASE}/events/${encodeURIComponent(eventId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(await _authHeaders()) },
                body: JSON.stringify(updates || {})
            });
            const body = await res.json().catch(() => ({}));
            return body;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    const api = { sendEmail, sendTest, listEvents, updateEvent };

    if (typeof window !== 'undefined') {
        window.EmailClient = api;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
