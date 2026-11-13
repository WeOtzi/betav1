/**
 * Inbox del estudio + solicitudes de cambio de invitaciones.
 * Migración: 20261112210000_estudio_inbox.sql.
 *
 * Las RPC verifican que auth.uid() sea el dueño del estudio (studios.user_id).
 * Una vez abierto el hilo (open_studio_inbox_thread) el estudio es
 * participante y se reutiliza WeotziData.Inbox (inbox-repo.js) para leer
 * mensajes, enviar, marcar leído, favoritos/archivo y adjuntos.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[studio-inbox-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const StudioInbox = {
        async listThreads(studioId) {
            const { data } = await D.run('studioInbox.listThreads', (c) =>
                c.rpc('list_studio_inbox_threads', { p_studio_id: studioId })
            );
            return data || [];
        },

        async openThread(studioId, threadId) {
            const { data } = await D.run('studioInbox.openThread', (c) =>
                c.rpc('open_studio_inbox_thread', { p_studio_id: studioId, p_thread_id: threadId })
            );
            return data;
        },

        async listChangeRequests(studioId) {
            const { data } = await D.run('studioInbox.listChangeRequests', (c) =>
                c.rpc('list_studio_invitation_change_requests', { p_studio_id: studioId })
            );
            return Array.isArray(data) ? data : [];
        },

        async respondChangeRequest({ requestId, decision, reply = null, changes = {} }) {
            const { data } = await D.run('studioInbox.respondChangeRequest', (c) =>
                c.rpc('respond_studio_invitation_change_request', {
                    p_request_id: requestId,
                    p_decision: decision,
                    p_reply: reply || null,
                    p_changes: changes || {},
                })
            );
            return data;
        },

        subscribeStudio(userId, onChange) {
            return D.channel(`studio-inbox-list-${userId}`)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'inbox_thread_participants',
                    filter: `user_id=eq.${userId}`,
                }, onChange)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'inbox_threads',
                }, onChange)
                .subscribe();
        },

        removeChannel(channel) {
            if (channel) D.removeChannel(channel);
        },
    };

    D.StudioInbox = StudioInbox;
})();
