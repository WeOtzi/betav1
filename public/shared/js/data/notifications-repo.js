/**
 * WE OTZI - Repositorio de avisos del usuario (frente push · P24)
 * ----------------------------------------------------------------
 * Tabla user_notifications (migración 20261116170000): el servidor inserta un
 * aviso por cada novedad (lib/push-dispatch.js); acá solo se LEE, se marca
 * leído y se escucha por Realtime (RLS de dueño). También envuelve los
 * endpoints /api/push/* (suscripción Web Push y aviso de prueba).
 *
 * Carga: DESPUÉS de config-manager.js y data/postgrest-client.js. Lo carga
 * public/shared/js/wo-notify.js en todas las páginas con sesión.
 * Expone window.WeotziData.Notifications.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.getClient !== 'function') {
        console.error('[notifications-repo] Falta la capa de datos (postgrest-client.js).');
        return;
    }

    const COLUMNS = 'id, role, kind, event_id, title, body, url, tag, created_at, read_at';

    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (window.location && window.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    async function post(path, payload, { accessToken, keepalive = false } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const res = await fetch(basePath() + path, {
            method: 'POST', headers, body: JSON.stringify(payload || {}), keepalive,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) {
            const error = new Error(body.error || `HTTP ${res.status}`);
            error.status = res.status;
            error.code = body.code || null;
            throw error;
        }
        return body;
    }

    const Notifications = {
        // Avisos recientes del usuario (los más nuevos primero).
        async listRecent(userId, { since = null, limit = 20, unreadOnly = false } = {}) {
            const { data } = await D.run('notifications.listRecent', (c) => {
                let q = c.from('user_notifications').select(COLUMNS).eq('user_id', userId);
                if (since) q = q.gte('created_at', since);
                if (unreadOnly) q = q.is('read_at', null);
                return q.order('created_at', { ascending: false }).limit(limit);
            });
            return data || [];
        },

        async markRead(id) {
            await D.run('notifications.markRead', (c) =>
                c.from('user_notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
            );
        },

        // Realtime: un aviso nuevo del usuario (INSERT). Devuelve el canal.
        subscribe(userId, onInsert, channelName) {
            return D.channel(channelName || `wo-notify-${userId}`)
                .on('postgres_changes', {
                    event: 'INSERT', schema: 'public', table: 'user_notifications',
                    filter: `user_id=eq.${userId}`,
                }, (payload) => { if (payload && payload.new) onInsert(payload.new); })
                .subscribe();
        },

        unsubscribe(channel) {
            if (channel) D.removeChannel(channel);
        },

        // ---- Web Push (servidor) ----
        Push: {
            // { enabled, publicKey }: sin claves VAPID en el servidor, enabled=false.
            async config() {
                const res = await fetch(`${basePath()}/api/push/config`, { cache: 'no-store' });
                const body = await res.json().catch(() => ({}));
                return { enabled: !!(res.ok && body.enabled && body.publicKey), publicKey: body.publicKey || null };
            },
            subscribe(accessToken, subscription) {
                return post('/api/push/subscribe', { subscription }, { accessToken });
            },
            unsubscribe(endpoint, { keepalive = false } = {}) {
                return post('/api/push/unsubscribe', { endpoint }, { keepalive });
            },
            test(accessToken, role) {
                return post('/api/push/test', { role }, { accessToken });
            },
        },
    };

    D.Notifications = Notifications;
})();
