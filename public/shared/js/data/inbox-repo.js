/**
 * Unified artist Inbox repository.
 * Migration: 20260829153500_unified_artist_inbox.sql.
 * Legacy quotation/support repositories remain loaded independently and are
 * merged by artist-inbox.js as compatibility sources.
 *
 * Ronda 2 (20261116160000 / 20261116160200): mensajes de voz
 * (send_inbox_voice_message, attachment_duration_ms) y mensajes automáticos
 * del artista (columna auto_kind).
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

    // Aviso por correo de mensaje nuevo del inbox directo (evento
    // inbox_message_received, definido por el frente de emails). El servidor
    // resuelve destinatarios y throttling desde el mensaje guardado; aquí solo
    // se informa qué mensaje se guardó. Nunca bloquea ni falla el envío.
    function notifyRecipient(threadId, saved) {
        const message = Array.isArray(saved) ? saved[0] : saved;
        if (!message || !message.id || !window.ConfigManager || typeof window.ConfigManager.sendN8NEvent !== 'function') return;
        try {
            void Promise.resolve(window.ConfigManager.sendN8NEvent('inbox_message_received', {
                thread_id: threadId, message_id: message.id,
            })).catch(() => {});
        } catch (_) { /* correo secundario */ }
    }

    const Inbox = {
        async listThreads() {
            const { data } = await D.run('inbox.listThreads', (c) =>
                c.rpc('list_artist_inbox_threads')
            );
            return data || [];
        },

        // Lado cliente: hilos del inbox unificado donde el usuario participa
        // como 'client' (p. ej. Job Board). Migración 20261115170100.
        async listClientThreads() {
            const { data } = await D.run('inbox.listClientThreads', (c) =>
                c.rpc('list_client_inbox_threads')
            );
            return data || [];
        },

        async listMessages(threadId) {
            const { data } = await D.run('inbox.listMessages', (c) =>
                // '*' trae también attachment_duration_ms y auto_kind (ronda 2)
                // sin romper si la migración todavía no corrió.
                c.from('inbox_messages')
                    .select('*')
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
            // EM-07: un solo aviso por email al otro participante (el servidor
            // resuelve el hilo y el destinatario, espera un rato, no avisa si ya
            // se leyó y manda como mucho uno cada 15 min). Nunca rompe el envío.
            const saved = Array.isArray(data) ? data[0] : data;
            notifyRecipient((saved && saved.thread_id) || threadId, data);
            return data;
        },

        // Mensaje de voz (P8): el audio ya está en inbox-attachments
        // (uploadAttachment); la base valida el objeto real, completa tamaño y
        // MIME y guarda la duración. Mismo aviso por email que un mensaje común.
        async sendVoiceMessage({ threadId, attachment, durationMs, clientNonce = null }) {
            const { data } = await D.run('inbox.sendVoiceMessage', (c) =>
                c.rpc('send_inbox_voice_message', {
                    p_thread_id: threadId,
                    p_attachment_path: attachment?.path || null,
                    p_attachment_mime: attachment?.type || null,
                    p_duration_ms: Math.round(Number(durationMs) || 0),
                    p_client_nonce: clientNonce || (crypto.randomUUID ? crypto.randomUUID() : null),
                })
            );
            const saved = Array.isArray(data) ? data[0] : data;
            notifyRecipient((saved && saved.thread_id) || threadId, data);
            return data;
        },

        // Mensajes automáticos recientes de los hilos del usuario (P9). La
        // lista los usa para saber si lo último de un hilo fue un automático.
        // Nunca rompe la carga del inbox: sin la columna devuelve [].
        async listRecentAuto(limit = 200) {
            try {
                const { data } = await D.run('inbox.listRecentAuto', (c) =>
                    c.from('inbox_messages')
                        .select('thread_id,created_at,auto_kind')
                        .not('auto_kind', 'is', null)
                        .order('created_at', { ascending: false })
                        .limit(limit)
                );
                return data || [];
            } catch (_) {
                return [];
            }
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

        // Limpieza de un adjunto que no llegó a enviarse (best effort).
        async removeAttachment(path) {
            if (!path) return;
            try { await client().storage.from(BUCKET).remove([path]); } catch (_) { /* queda huérfano */ }
        },

        async signedAttachmentUrl(path) {
            const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 3600);
            if (error) throw error;
            return data?.signedUrl || null;
        },

        subscribeThread(threadId, onMessage, prefix = 'artist-inbox-thread') {
            return D.channel(`${prefix}-${threadId}`)
                .on('postgres_changes', {
                    event: 'INSERT', schema: 'public', table: 'inbox_messages',
                    filter: `thread_id=eq.${threadId}`,
                }, onMessage)
                .subscribe();
        },

        subscribeList(userId, onChange, prefix = 'artist-inbox-list') {
            const channel = D.channel(`${prefix}-${userId}`)
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
