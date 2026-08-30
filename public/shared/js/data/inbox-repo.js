/**
 * Unified artist Inbox repository.
 * Migration: 20260829153500_unified_artist_inbox.sql.
 * Legacy quotation/support repositories remain loaded independently and are
 * merged by artist-inbox.js as compatibility sources.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[inbox-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const BUCKET = 'inbox-attachments';

    function client() {
        const value = D.getClient();
        if (!value) throw new Error('Supabase client unavailable');
        return value;
    }

    function safeFileName(name) {
        return String(name || 'archivo')
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'archivo';
    }

    const Inbox = {
        async listThreads() {
            const { data } = await D.run('inbox.listThreads', (c) =>
                c.rpc('list_artist_inbox_threads')
            );
            return data || [];
        },

        async listMessages(threadId) {
            const { data } = await D.run('inbox.listMessages', (c) =>
                c.from('inbox_messages')
                    .select('id,thread_id,sender_user_id,sender_role,body,message_kind,attachment_path,attachment_name,attachment_mime,attachment_size,created_at')
                    .eq('thread_id', threadId)
                    .order('created_at', { ascending: true })
                    .order('id', { ascending: true })
            );
            return data || [];
        },

        async sendMessage({ threadId, body = null, attachment = null, clientNonce = null }) {
            const payload = {
                p_thread_id: threadId,
                p_body: body || null,
                p_attachment_path: attachment?.path || null,
                p_attachment_name: attachment?.name || null,
                p_attachment_mime: attachment?.type || null,
                p_attachment_size: attachment?.size ?? null,
                p_client_nonce: clientNonce || (crypto.randomUUID ? crypto.randomUUID() : null),
            };
            const { data } = await D.run('inbox.sendMessage', (c) =>
                c.rpc('send_inbox_message', payload)
            );
            return data;
        },

        async markRead(threadId) {
            await D.run('inbox.markRead', (c) =>
                c.rpc('mark_inbox_thread_read', { p_thread_id: threadId })
            );
        },

        async setFlags(threadId, { favorite = null, archived = null } = {}) {
            const { data } = await D.run('inbox.setFlags', (c) =>
                c.rpc('set_inbox_thread_flags', {
                    p_thread_id: threadId,
                    p_is_favorite: favorite,
                    p_is_archived: archived,
                })
            );
            return data;
        },

        async uploadAttachment(threadId, userId, file) {
            if (!file) return null;
            if (file.size > 15 * 1024 * 1024) {
                throw new Error('El archivo supera el límite de 15 MB.');
            }
            const name = safeFileName(file.name);
            const path = `${threadId}/${userId}/${Date.now()}-${name}`;
            const { error } = await client().storage.from(BUCKET).upload(path, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || undefined,
            });
            if (error) throw error;
            return { path, name: file.name, type: file.type || null, size: file.size };
        },

        async signedAttachmentUrl(path) {
            const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 3600);
            if (error) throw error;
            return data?.signedUrl || null;
        },

        subscribeThread(threadId, onMessage) {
            return D.channel(`artist-inbox-thread-${threadId}`)
                .on('postgres_changes', {
                    event: 'INSERT', schema: 'public', table: 'inbox_messages',
                    filter: `thread_id=eq.${threadId}`,
                }, onMessage)
                .subscribe();
        },

        subscribeList(userId, onChange) {
            const channel = D.channel(`artist-inbox-list-${userId}`)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'inbox_thread_participants',
                    filter: `user_id=eq.${userId}`,
                }, onChange)
                .on('postgres_changes', {
                    event: '*', schema: 'public', table: 'inbox_threads',
                }, onChange)
                .subscribe();
            return channel;
        },

        removeChannel(channel) {
            if (channel) D.removeChannel(channel);
        },
    };

    D.Inbox = Inbox;
})();
