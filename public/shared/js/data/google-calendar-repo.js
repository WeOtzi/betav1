/**
 * WE OTZI - Repositorio de Google Calendar (frontend) · ronda 3b, grupo "gcal".
 * Expone window.WeotziData.GoogleCalendar.
 *
 *   status()        → { configured, connected, google_email, last_sync_at,
 *                       last_error, needs_reauth, available }
 *                     Servidor (/api/google-calendar/status); si el servidor
 *                     no responde (preview, versión vieja) cae a la RPC
 *                     get_my_google_calendar_connection (sin tokens).
 *   authorizeUrl()  → URL de consentimiento de Google (la arma el servidor).
 *   disconnect()    → revoca en Google y borra la conexión.
 *   syncSoon()      → pide una sincronización (debounce de 4 s; no bloquea).
 *   listBusy(userId, from, to) → bloques "ocupado" importados (RLS: solo los propios).
 *
 * Nunca recibe ni guarda tokens: todo eso vive en el servidor.
 * Carga: postgrest-client.js primero.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[google-calendar-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const BUSY_TABLE = 'artist_google_calendar_busy';
    let syncTimer = null;
    let cachedStatus = null;

    function appPath(path) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') return window.WoDemo.appPath(path);
        const base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

    async function accessToken() {
        try {
            const client = D.getClient();
            const { data } = client ? await client.auth.getSession() : { data: null };
            return data?.session?.access_token || '';
        } catch (_error) {
            return '';
        }
    }

    // Devuelve { status, json }. No lanza por HTTP; sí por red.
    async function api(path, method = 'GET') {
        const token = await accessToken();
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(appPath(path), { method, headers, cache: 'no-store', credentials: 'same-origin' });
        let json = null;
        try { json = await res.json(); } catch (_error) { json = null; }
        return { status: res.status, json: json || {} };
    }

    function errorFrom(result, fallback) {
        const err = new Error(result.json?.error || fallback);
        err.status = result.status;
        err.configured = result.json?.configured !== false;
        return err;
    }

    async function statusFromRpc() {
        const { data } = await D.run('googlecalendar.status', (c) => c.rpc('get_my_google_calendar_connection'));
        const row = Array.isArray(data) ? data[0] : data;
        return {
            configured: null,
            available: true,
            connected: !!row?.connected,
            google_email: row?.google_email || null,
            last_sync_at: row?.last_sync_at || null,
            last_error: row?.last_error || null,
            needs_reauth: !!row?.needs_reauth,
        };
    }

    const GoogleCalendar = {
        async status() {
            let result = null;
            try {
                result = await api('/api/google-calendar/status');
            } catch (_error) {
                result = null;
            }
            if (result && result.status === 200 && result.json.success) {
                return Object.assign({ available: true }, result.json, { configured: true });
            }
            if (result && result.status === 503 && result.json.configured === false) {
                return { configured: false, available: false, connected: false };
            }
            if (result && result.status === 401) {
                return { configured: null, available: false, connected: false, unauthorized: true };
            }
            // Preview o servidor sin el endpoint: estado de solo lectura por RPC.
            try {
                const fallback = await statusFromRpc();
                fallback.readonly = true;
                return fallback;
            } catch (_error) {
                return { configured: null, available: false, connected: false };
            }
        },

        async authorizeUrl() {
            const result = await api('/api/google-calendar/authorize');
            if (result.status !== 200 || !result.json.url) throw errorFrom(result, 'No pudimos iniciar la conexión con Google.');
            return result.json.url;
        },

        async disconnect() {
            const result = await api('/api/google-calendar/disconnect', 'POST');
            if (result.status !== 200 || !result.json.success) throw errorFrom(result, 'No pudimos desconectar Google Calendar.');
            return result.json;
        },

        async syncNow() {
            const result = await api('/api/google-calendar/sync', 'POST');
            if (result.status !== 200) throw errorFrom(result, 'No pudimos sincronizar con Google Calendar.');
            return result.json.result || null;
        },

        // Al guardar/borrar un evento del calendario. Silencioso y solo si hay
        // una conexión activa (el estado se consulta una vez por página).
        syncSoon(delayMs = 4000) {
            clearTimeout(syncTimer);
            syncTimer = setTimeout(async () => {
                try {
                    if (!cachedStatus) cachedStatus = GoogleCalendar.status();
                    const st = await cachedStatus;
                    if (!st || !st.connected || st.readonly || st.needs_reauth) return;
                    await api('/api/google-calendar/sync', 'POST');
                } catch (_error) { /* la próxima corrida del job lo levanta */ }
            }, delayMs);
        },

        async listBusy(artistUserId, rangeStart, rangeEnd) {
            const from = new Date(rangeStart).toISOString();
            const to = new Date(rangeEnd).toISOString();
            const { data } = await D.run('googlecalendar.listBusy', (c) =>
                c.from(BUSY_TABLE)
                    .select('google_event_id,starts_at,ends_at,all_day')
                    .eq('user_id', artistUserId)
                    .lt('starts_at', to)
                    .gt('ends_at', from)
                    .order('starts_at', { ascending: true })
                    .limit(1000)
            );
            return data || [];
        },
    };

    D.GoogleCalendar = GoogleCalendar;
})();
