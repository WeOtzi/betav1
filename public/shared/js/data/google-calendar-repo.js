/**
 * WE OTZI - Repositorio de Google Calendar (frontend) · grupo "gcal".
 * Expone window.WeotziData.GoogleCalendar.
 *
 *   status()        → { configured, connected, google_email, last_sync_at,
 *                       last_error, needs_reauth, timezone, available }
 *                     Servidor (/api/google-calendar/status); si el servidor
 *                     no responde (preview, versión vieja) cae a la RPC
 *                     get_my_google_calendar_connection (sin tokens).
 *   authorizeUrl()  → URL de consentimiento de Google (la arma el servidor).
 *   disconnect({ removeEvents }) → revoca en Google y borra la conexión; con
 *                     removeEvents quita de Google los eventos de We Ötzi que
 *                     todavía no pasaron (los pasados quedan como historial).
 *   syncSoon()      → pide una sincronización (debounce de 1,5 s; no bloquea).
 *   wrapWrites(obj, names) → envuelve métodos de otro repo para pedir la
 *                     sincronización después de escribir. Al cargar se
 *                     envuelven solos QuotationDetail (sesiones y estado de la
 *                     cotización) y Quotations.createManual (cita manual), si
 *                     esos repos se cargaron ANTES que este archivo.
 *   ensureTimezone() → guarda la zona horaria del navegador en
 *                     user_preferences.app_settings.timezone si todavía no hay
 *                     una (CAL-14). Corre sola una vez por sesión.
 *   Solo de ida (20261114100000): no se lee el calendario de Google.
 *   La base además marca cada cambio (20261115150000): aunque una escritura
 *   no pase por acá, llega a Google en menos de un minuto.
 *
 * Nunca recibe ni guarda tokens: todo eso vive en el servidor.
 * Carga: postgrest-client.js primero (y account-repo.js para ensureTimezone).
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[google-calendar-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const SYNC_DELAY_MS = 1500;
    const TZ_FLAG = 'wo_tz_saved_v1';
    let syncTimer = null;
    let cachedStatus = null;

    function appPath(path) {
        if (window.WoDemo && typeof window.WoDemo.appPath === 'function') return window.WoDemo.appPath(path);
        const base = window.WEOTZI_BASE_PATH
            ? String(window.WEOTZI_BASE_PATH).replace(/\/$/, '')
            : (/^\/beta(?:\/|$)/.test(String(window.location.pathname || '')) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

    async function session() {
        try {
            const client = D.getClient();
            const { data } = client ? await client.auth.getSession() : { data: null };
            return data?.session || null;
        } catch (_error) {
            return null;
        }
    }

    async function accessToken() {
        const current = await session();
        return current?.access_token || '';
    }

    // Devuelve { status, json }. No lanza por HTTP; sí por red.
    async function api(path, method = 'GET', body = null) {
        const token = await accessToken();
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetch(appPath(path), {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store',
            credentials: 'same-origin',
        });
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

    function browserTimeZone() {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return typeof tz === 'string' && tz ? tz : null;
        } catch (_error) {
            return null;
        }
    }

    function readFlag() {
        try { return window.sessionStorage.getItem(TZ_FLAG); } catch (_error) { return null; }
    }

    function writeFlag(value) {
        try { window.sessionStorage.setItem(TZ_FLAG, value); } catch (_error) { /* sin storage */ }
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

        async disconnect(options = {}) {
            const result = await api('/api/google-calendar/disconnect', 'POST', { removeEvents: options.removeEvents === true });
            if (result.status !== 200 || !result.json.success) throw errorFrom(result, 'No pudimos desconectar Google Calendar.');
            cachedStatus = null;
            return result.json;
        },

        async syncNow() {
            const result = await api('/api/google-calendar/sync', 'POST');
            if (result.status !== 200) throw errorFrom(result, 'No pudimos sincronizar con Google Calendar.');
            return result.json.result || null;
        },

        // Al guardar/borrar algo de la agenda. Silencioso y solo si hay una
        // conexión activa (el estado se consulta una vez por página). El
        // servidor agenda una corrida diferida si llega dentro de su freno.
        syncSoon(delayMs = SYNC_DELAY_MS) {
            clearTimeout(syncTimer);
            syncTimer = setTimeout(async () => {
                try {
                    if (!cachedStatus) cachedStatus = GoogleCalendar.status();
                    const st = await cachedStatus;
                    if (!st || !st.connected || st.readonly || st.needs_reauth) return;
                    await api('/api/google-calendar/sync', 'POST');
                } catch (_error) { /* la marca de la base y el job lo levantan */ }
            }, delayMs);
        },

        // Envuelve métodos de escritura de otro repo: después de escribir pide
        // la sincronización. Idempotente (no envuelve dos veces). shouldSync
        // (opcional) decide por llamada: (name, args) → boolean.
        wrapWrites(target, names, shouldSync) {
            if (!target || !Array.isArray(names)) return 0;
            let wrapped = 0;
            names.forEach((name) => {
                const original = target[name];
                if (typeof original !== 'function' || original.__gcalWrapped) return;
                const fn = async function gcalSyncAfterWrite(...args) {
                    const result = await original.apply(this, args);
                    try {
                        if (typeof shouldSync !== 'function' || shouldSync(name, args)) GoogleCalendar.syncSoon();
                    } catch (_error) { /* opcional */ }
                    return result;
                };
                fn.__gcalWrapped = true;
                target[name] = fn;
                wrapped += 1;
            });
            return wrapped;
        },

        // CAL-14: el servidor publica en Google con la zona de
        // app_settings.timezone. Si nunca se guardó, se guarda la del
        // navegador (no pisa una elegida en Cuenta → Configuración).
        async ensureTimezone() {
            const tz = browserTimeZone();
            if (!tz || !D.Prefs || typeof D.Prefs.get !== 'function' || typeof D.Prefs.saveSection !== 'function') return null;
            const current = await session();
            const userId = current?.user?.id;
            if (!userId) return null;
            if (readFlag() === userId) return null;
            const row = await D.Prefs.get(userId);
            const saved = row && row.app_settings && typeof row.app_settings.timezone === 'string' ? row.app_settings.timezone : '';
            if (saved) { writeFlag(userId); return saved; }
            await D.Prefs.saveSection(userId, 'app_settings', { timezone: tz });
            writeFlag(userId);
            return tz;
        },
    };

    D.GoogleCalendar = GoogleCalendar;

    function wrapKnownRepos() {
        // updateQuote solo cuando cambia algo que se ve en Google (estado o
        // cliente); las notas o artist_viewed_at no disparan nada.
        GoogleCalendar.wrapWrites(D.QuotationDetail, ['createSession', 'updateSession', 'updateQuote'], (name, args) => {
            if (name !== 'updateQuote') return true;
            const patch = args && args[1];
            return !!patch && ('quote_status' in patch || 'client_full_name' in patch);
        });
        GoogleCalendar.wrapWrites(D.Quotations, ['createManual']);
    }

    wrapKnownRepos();
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wrapKnownRepos, { once: true });
    }

    // Una vez por sesión del navegador, sin bloquear la página.
    setTimeout(() => {
        GoogleCalendar.ensureTimezone().catch(() => null);
    }, 2500);
})();
