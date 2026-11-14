// ============================================
// We Ötzi · Bienvenida idempotente (frente acceso, ACC-04)
// ============================================
// Pide al servidor el correo de bienvenida cuando la persona ya tiene sesión
// con la cuenta confirmada: POST /api/account/welcome { role }. El servidor
// decide (email confirmado, cuenta posterior a la fecha de corte, perfil
// existente) y deduplica por usuario en email_delivery_ledger, así que se
// puede llamar desde cualquier pantalla: sale una sola vez, también si la
// persona confirmó el email en otro dispositivo.
//
// En /artist/dashboard y /client/dashboard corre solo. En otras páginas:
//   window.WoWelcome.request('client')
// Nunca muestra errores: la bienvenida no bloquea nada.
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object') root.WoWelcome = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';

    const FLAG_PREFIX = 'wo_welcome_checked:';

    function basePath() {
        if (root.WEOTZI_BASE_PATH) return String(root.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const pathname = (root.location && root.location.pathname) || '';
        return /^\/beta(?:\/|$)/.test(pathname) ? '/beta' : '';
    }

    // Rol según la página (sin base path). null = no corre solo.
    function roleForPath(pathname) {
        const base = basePath();
        let p = String(pathname || '');
        if (base && p.indexOf(base + '/') === 0) p = p.slice(base.length);
        if (/^\/artist\/dashboard(\/|$)/.test(p)) return 'artist';
        if (/^\/client\/dashboard(\/|$)/.test(p)) return 'client';
        return null;
    }

    function storage() {
        try { return root.sessionStorage || null; } catch (_) { return null; }
    }

    function alreadyChecked(key) {
        const s = storage();
        try { return Boolean(s && s.getItem(key)); } catch (_) { return false; }
    }

    function markChecked(key) {
        const s = storage();
        try { if (s) s.setItem(key, '1'); } catch (_) { /* sin storage: el ledger igual deduplica */ }
    }

    async function supabaseClient() {
        const CM = root.ConfigManager;
        if (CM && typeof CM.ready === 'function') {
            try { await CM.ready(); } catch (_) { /* sigue con lo que haya */ }
        }
        if (CM && typeof CM.getSupabaseClient === 'function') {
            const c = CM.getSupabaseClient();
            if (c) return c;
        }
        return root._supabase || null;
    }

    /**
     * Pide la bienvenida una vez por pestaña y usuario. Devuelve la respuesta
     * del servidor o null (sin sesión, ya pedida o error de red).
     */
    async function request(role, opts) {
        const o = opts || {};
        if (role !== 'artist' && role !== 'client') return null;
        try {
            const client = o.client || await supabaseClient();
            if (!client || !client.auth || typeof client.auth.getSession !== 'function') return null;
            const { data } = await client.auth.getSession();
            const session = data && data.session;
            const user = session && session.user;
            if (!user || !session.access_token) return null;
            // Sin confirmar no se pide (el servidor tampoco la enviaría).
            if (!user.email_confirmed_at && !user.confirmed_at) return null;
            const key = FLAG_PREFIX + role + ':' + user.id;
            if (alreadyChecked(key)) return null;
            markChecked(key);
            const fetchImpl = o.fetch || root.fetch;
            const res = await fetchImpl(basePath() + '/api/account/welcome', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
                body: JSON.stringify({ role: role }),
                keepalive: true
            });
            const body = await res.json().catch(function () { return {}; });
            // Falla del servidor o del correo: se permite reintentar en otra carga.
            if (!res.ok || (body && body.reason === 'delivery_failed')) {
                const s = storage();
                try { if (s) s.removeItem(key); } catch (_) { /* noop */ }
            }
            return body;
        } catch (_) {
            return null;
        }
    }

    function autoRun() {
        const role = roleForPath(root.location && root.location.pathname);
        if (role) request(role);
    }

    if (root.document && typeof root.document.addEventListener === 'function' && root.location) {
        if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoRun);
        else autoRun();
    }

    return { request: request, roleForPath: roleForPath, FLAG_PREFIX: FLAG_PREFIX };
});
