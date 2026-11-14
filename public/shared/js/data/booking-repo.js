/**
 * WE OTZI - Repositorio de turnos / reservas online (frontend).
 * Expone window.WeotziData.Booking. Todo pasa por el servidor
 * (lib/routes/turnos.js): el cálculo de turnos, los apartados y los emails
 * viven ahí; el navegador nunca escribe artist_booking_holds.
 *
 *   summary()                    → resumen del artista (semana/mes/3 meses/año)
 *   ownSlots(from, to)           → turnos propios (incluye reservas apagadas)
 *   getSettings() / saveSettings(value)
 *   listHolds(from, to)          → apartados pendientes (para el calendario)
 *   holdForQuotation(id)         → turno pedido de una cotización
 *   confirmHold(id, {starts_at, minutes}) / releaseHold(id, reason)
 *   publicSlots(username, {from, to, granularity})  (sin sesión)
 *
 * Carga: postgrest-client.js primero (para la sesión).
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
        err.payload = json || {};
        return err;
    }

    async function api(path, { method = 'GET', body, auth = true, fallback = 'No pudimos conectar con el servidor.' } = {}) {
        const headers = { Accept: 'application/json' };
        if (auth) {
            const token = await accessToken();
            if (token) headers.Authorization = `Bearer ${token}`;
        }
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(appPath(path), {
            method, headers, credentials: 'same-origin',
            cache: method === 'GET' && !auth ? 'default' : 'no-store',
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try { json = await res.json(); } catch (_error) { json = null; }
        if (!res.ok || !json || json.success === false) throw errorFrom(res.status, json, fallback);
        return json;
    }

    function qs(params) {
        const out = new URLSearchParams();
        Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== '') out.set(k, params[k]); });
        const s = out.toString();
        return s ? `?${s}` : '';
    }

    const Booking = {
        summary() {
            return api('/api/calendar/availability?summary=1', { fallback: 'No pudimos calcular tus turnos disponibles.' });
        },
        ownSlots(from, to) {
            return api(`/api/calendar/availability${qs({ summary: 1, from, to })}`, { fallback: 'No pudimos calcular tus turnos disponibles.' });
        },
        getSettings() {
            return api('/api/calendar/booking-settings', { fallback: 'No pudimos leer tu configuración de turnos.' });
        },
        saveSettings(value) {
            return api('/api/calendar/booking-settings', { method: 'PUT', body: value, fallback: 'No pudimos guardar tu configuración de turnos.' });
        },
        async listHolds(from, to) {
            const json = await api(`/api/calendar/booking-holds${qs({ from, to })}`, { fallback: 'No pudimos leer tus solicitudes de turno.' });
            return json.holds || [];
        },
        holdForQuotation(quotationId) {
            return api(`/api/turnos/quotations/${encodeURIComponent(quotationId)}/hold`, { fallback: 'No pudimos leer el turno de la cotización.' });
        },
        confirmHold(holdId, options = {}) {
            return api(`/api/turnos/holds/${encodeURIComponent(holdId)}/confirm`, {
                method: 'POST',
                body: Object.assign(
                    { starts_at: options.starts_at || null, minutes: options.minutes || null },
                    options.from_agreement ? { from_agreement: true } : {}
                ),
                fallback: 'No pudimos reservar el turno.',
            });
        },
        releaseHold(holdId, reason) {
            return api(`/api/turnos/holds/${encodeURIComponent(holdId)}/release`, {
                method: 'POST', body: { reason: reason || null }, fallback: 'No pudimos liberar el turno.',
            });
        },
        publicSlots(username, options = {}) {
            return api(`/api/public/artists/${encodeURIComponent(String(username || '').replace(/^@+/, ''))}/slots${qs({
                from: options.from, to: options.to, granularity: options.granularity,
            })}`, { auth: false, fallback: 'No pudimos cargar los turnos.' });
        },
        // Enlace público para compartir.
        publicUrl(username) {
            const u = String(username || '').replace(/^@+/, '').trim();
            if (!u) return '';
            const origin = window.location.origin;
            return origin + appPath(`/turnos?artist=${encodeURIComponent(u)}`);
        },
    };

    D.Booking = Booking;
})();
