/**
 * WE OTZI - Repositorio · verificación del perfil del artista (frontend)
 * ----------------------------------------------------------------------
 * Frente verif-artista (beta cerrada). Cuenta · Verificación del artista:
 *   - lastDecision(artistUserId): última decisión de soporte sobre su perfil
 *     (verification_history; RLS verification_history_owner_select,
 *     migración 20261115190000). Sirve para mostrar el motivo al denegar.
 *   - request(): pide la verificación al servidor
 *     (POST /api/artist/verification/request), que valida los documentos,
 *     deja historial y avisa a soporte.
 * Carga: DESPUÉS de postgrest-client.js. Expone WeotziData.ArtistVerification.
 */
(function (root) {
    'use strict';

    var D = root.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[artist-verification-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    var run = D.run;

    function appPath(path) {
        if (root.WoDemo && typeof root.WoDemo.appPath === 'function') return root.WoDemo.appPath(path);
        var loc = String((root.location && root.location.pathname) || '');
        var base = root.WEOTZI_BASE_PATH ? String(root.WEOTZI_BASE_PATH).replace(/\/$/, '') : (/^\/beta(?:\/|$)/.test(loc) ? '/beta' : '');
        return base && String(path).indexOf(base + '/') !== 0 ? base + path : path;
    }

    async function accessToken() {
        try {
            var client = typeof D.getClient === 'function' ? D.getClient() : null;
            var sess = client ? await client.auth.getSession() : null;
            return (sess && sess.data && sess.data.session && sess.data.session.access_token) || '';
        } catch (_e) {
            return '';
        }
    }

    var ArtistVerification = {
        async lastDecision(artistUserId) {
            if (!artistUserId) return null;
            try {
                var res = await run('artistVerification.lastDecision', function (c) {
                    return c.from('verification_history')
                        .select('id, action, notes, created_at, artists_db!inner(user_id)')
                        .eq('artists_db.user_id', artistUserId).neq('action', 'pending_review')
                        .order('created_at', { ascending: false }).limit(1);
                });
                return (res && res.data && res.data[0]) || null;
            } catch (err) {
                // Sin la migración o sin historial: la cuenta sigue funcionando.
                console.warn('[artist-verification-repo] última decisión:', err && err.message);
                return null;
            }
        },

        // { state, changed, support_notified } o lanza Error con .status y el mensaje del servidor.
        async request() {
            var json = null;
            var status = 0;
            if (root.WoDemo && typeof root.WoDemo.api === 'function') {
                try {
                    json = await root.WoDemo.api('/api/artist/verification/request', { method: 'POST', body: {} });
                    status = 200;
                } catch (err) {
                    var e1 = new Error((err && err.message) || 'No pudimos enviar la solicitud.');
                    e1.status = err && err.status;
                    throw e1;
                }
            } else {
                var token = await accessToken();
                var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
                if (token) headers.Authorization = 'Bearer ' + token;
                var res = await root.fetch(appPath('/api/artist/verification/request'), {
                    method: 'POST', headers: headers, cache: 'no-store', credentials: 'same-origin', body: '{}'
                });
                status = res.status;
                try { json = await res.json(); } catch (_e) { json = null; }
                if (!res.ok || !json || json.success === false) {
                    var e2 = new Error((json && json.error) || 'No pudimos enviar la solicitud.');
                    e2.status = status;
                    throw e2;
                }
            }
            return json || {};
        }
    };

    D.ArtistVerification = ArtistVerification;
}(typeof window !== 'undefined' ? window : this));
