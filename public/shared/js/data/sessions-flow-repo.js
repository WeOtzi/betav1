/**
 * WE OTZI - Repositorio de sesiones (frontend · ronda 2 · frente "sesiones").
 * Expone window.WeotziData.SessionFlow. Todo pasa por el servidor
 * (lib/routes/sesiones.js): la confirmación del cliente, los cambios de común
 * acuerdo, el registro y las disputas se validan y guardan ahí, y de ahí salen
 * los correos. El navegador nunca escribe esas tablas.
 *
 *   forQuote(quoteId)                  → { role, quote, sessions } de una cotización
 *   mine()                             → sesiones del cliente (panel "Mis sesiones")
 *   locations(quoteId?)                → opciones de ubicación del artista
 *   confirm(sessionId)                 → el cliente confirma
 *   requestChange(sessionId, body)     → pedir un cambio
 *   respond(requestId, { decision, note }) / withdraw(requestId)
 *   feedback(sessionId, { rating, note })
 *   dispute(sessionId, { reason, description })
 *
 * Carga: postgrest-client.js primero (para la sesión de Supabase).
 */
(function () {
    'use strict';

    const D = window.WeotziData = window.WeotziData || {};

    function appPath(path) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') return window.WoDemo.appPath(path);
        const base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

    function isPreview() {
        return window.WEOTZI_PREVIEW === true || !!(window.WoDemo && window.WoDemo.enabled);
    }

    async function accessToken() {
        try {
            const client = typeof D.getClient === 'function' ? D.getClient()
                : (window.ConfigManager && window.ConfigManager.getSupabaseClient && window.ConfigManager.getSupabaseClient());
            const { data } = client ? await client.auth.getSession() : { data: null };
            return (data && data.session && data.session.access_token) || '';
        } catch (_error) {
            return '';
        }
    }

    function errorFrom(status, json, fallback) {
        const err = new Error((json && json.error) || fallback);
        err.status = status;
        err.code = (json && json.code) || null;
        err.userMessage = (json && json.error) || fallback;
        return err;
    }

    async function api(path, { method = 'GET', body, fallback = 'No pudimos conectar con el servidor.' } = {}) {
        // En la vista previa (demo) no hay servidor de sesiones: se comporta
        // como "función no disponible" y las pantallas usan el modo anterior.
        if (isPreview()) throw errorFrom(503, { code: 'sessions_unavailable', error: fallback }, fallback);
        const headers = { Accept: 'application/json' };
        const token = await accessToken();
        if (!token) throw errorFrom(401, { code: 'unauthenticated', error: 'Inicia sesión para continuar.' }, fallback);
        headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(appPath(path), {
                method, headers, credentials: 'same-origin', cache: 'no-store',
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch (_error) {
            throw errorFrom(0, { code: 'network', error: 'No hay conexión. Revisa tu red y prueba de nuevo.' }, fallback);
        }
        let json = null;
        try { json = await res.json(); } catch (_error) { json = null; }
        if (!res.ok || !json || json.success === false) throw errorFrom(res.status, json, fallback);
        return json;
    }

    const id = (value) => encodeURIComponent(String(value == null ? '' : value));

    const SessionFlow = {
        // 503 sessions_unavailable = la base todavía no tiene la migración.
        isUnavailable(error) {
            // 404 sin código = el servidor todavía no tiene las rutas de sesiones.
            return !!error && (error.code === 'sessions_unavailable' || error.status === 503 || (error.status === 404 && !error.code));
        },
        forQuote(quoteId) {
            return api(`/api/sesiones/quotations/${id(quoteId)}`, { fallback: 'No pudimos cargar las sesiones.' });
        },
        mine() {
            return api('/api/sesiones/mine', { fallback: 'No pudimos cargar tus sesiones.' });
        },
        async locations(quoteId) {
            const json = await api(`/api/sesiones/locations${quoteId ? `?quote=${id(quoteId)}` : ''}`, { fallback: 'No pudimos cargar tus ubicaciones.' });
            return { options: json.options || [], defaultKey: json.default_key || null };
        },
        confirm(sessionId) {
            return api(`/api/sesiones/${id(sessionId)}/confirm`, { method: 'POST', body: {}, fallback: 'No pudimos confirmar la sesión.' });
        },
        requestChange(sessionId, body) {
            return api(`/api/sesiones/${id(sessionId)}/change-requests`, { method: 'POST', body: body || {}, fallback: 'No pudimos enviar el pedido de cambio.' });
        },
        respond(requestId, body) {
            return api(`/api/sesiones/change-requests/${id(requestId)}/respond`, { method: 'POST', body: body || {}, fallback: 'No pudimos guardar tu respuesta.' });
        },
        withdraw(requestId) {
            return api(`/api/sesiones/change-requests/${id(requestId)}/withdraw`, { method: 'POST', body: {}, fallback: 'No pudimos retirar el pedido.' });
        },
        feedback(sessionId, body) {
            return api(`/api/sesiones/${id(sessionId)}/feedback`, { method: 'POST', body: body || {}, fallback: 'No pudimos guardar tu registro.' });
        },
        dispute(sessionId, body) {
            return api(`/api/sesiones/${id(sessionId)}/dispute`, { method: 'POST', body: body || {}, fallback: 'No pudimos registrar la disputa.' });
        },
    };

    D.SessionFlow = SessionFlow;
})();
