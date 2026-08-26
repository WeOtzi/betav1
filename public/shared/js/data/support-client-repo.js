/**
 * WE OTZI - Repositorio de soporte para el usuario final (frontend)
 * -----------------------------------------------------------------
 * Lado usuario del chat de soporte (support_conversations / support_messages)
 * para el hilo fijo "Soporte" del inbox (/artist/inbox y futuras vistas).
 *
 * Lectura: via la capa PostgREST unificada — la RLS permite leer las propias
 * conversaciones (user_id = auth.uid()) y sus mensajes.
 * Escritura: el INSERT directo esta bloqueado por RLS; los mensajes van por
 * POST /api/support-chat/message (server con service role; mismo contrato que
 * el widget public/shared/js/support-chat.js).
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.SupportInbox.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[support-client-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    // Mismo criterio de base path que quotations-repo (soporta /beta).
    function basePath() {
        if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
        const p = (window.location && window.location.pathname) || '';
        return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
    }

    async function authHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        try {
            const client = D.getClient();
            if (client) {
                const { data } = await client.auth.getSession();
                const token = data?.session?.access_token;
                if (token) headers.Authorization = `Bearer ${token}`;
            }
        } catch { /* sin sesion: el endpoint decide */ }
        return headers;
    }

    const SupportInbox = {
        // Ultima conversacion de soporte del usuario (o null si nunca hablo).
        // Prefiere la activa; si todas estan cerradas devuelve la mas reciente
        // para que el historial siga visible (la UI deshabilita el composer).
        async getOwnConversation(userId) {
            const { data } = await run('supportInbox.getOwnConversation', (c) =>
                c.from('support_conversations')
                    .select('id, status, page_context, last_message_at, created_at, closed_at')
                    .eq('user_id', userId)
                    .order('last_message_at', { ascending: false })
                    .limit(5)
            );
            const rows = data || [];
            if (!rows.length) return null;
            return rows.find((r) => r.status !== 'closed') || rows[0];
        },

        // Mensajes de una conversacion propia (RLS: solo las del usuario).
        // opts.since (ISO) para polling incremental.
        async listMessages(conversationId, opts = {}) {
            const { since = null, limit = 200 } = opts;
            const { data } = await run('supportInbox.listMessages', (c) => {
                let q = c.from('support_messages')
                    .select('id, role, content, created_at')
                    .eq('conversation_id', conversationId)
                    .order('created_at', { ascending: true })
                    .limit(limit);
                if (since) q = q.gt('created_at', since);
                return q;
            });
            return data || [];
        },

        // Envia un mensaje via el endpoint del servidor (INSERT directo bloqueado
        // por RLS). Devuelve el body { success, response, status } del endpoint;
        // `response` trae la respuesta inmediata del bot cuando status='bot'.
        async sendMessage({ conversationId, content, pageContext }) {
            const headers = await authHeaders();
            const res = await fetch(basePath() + '/api/support-chat/message', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    conversation_id: conversationId,
                    content,
                    page_context: pageContext || (window.location && window.location.pathname) || null,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.success === false) {
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            return body;
        },
    };

    D.SupportInbox = SupportInbox;
})();
