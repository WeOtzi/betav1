/**
 * WE OTZI - Repositorios del dominio Cotizaciones (frontend)
 * ----------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js).
 * Reemplazan los `_supabase.from('quotations_db')...` dispersos por los modulos.
 * Corren con la sesion del usuario (anon key + JWT): la seguridad la da RLS.
 *
 * Claves de relacion (ENCAPSULADAS aqui para que ningun llamador las repita):
 *   Notes.* / Sessions.*  usan quotation_id = quotations_db.id      (int, PK)
 *   Attachments.* / Chat.* usan quotation_id = quotations_db.quote_id (text)
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.{Quotations,
 * Notes, Sessions, Attachments, Chat, Realtime, Api}.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[quotations-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;
    const orValue = D.orValue;

    // ===================== quotations_db =====================
    const Quotations = {
        // Listado de cotizaciones del artista. opts: { excludeArchived,
        // excludeInProgress, order, limit, select }.
        async listForArtist(artistUserId, opts = {}) {
            const {
                excludeArchived = true,
                excludeInProgress = true,
                order = { column: 'created_at', ascending: false },
                limit = null,
                select = '*',
            } = opts;
            const { data } = await run('quotations.listForArtist', (c) => {
                let q = c.from('quotations_db').select(select).eq('artist_id', artistUserId);
                if (excludeArchived) q = q.eq('is_archived', false);
                if (excludeInProgress) q = q.neq('quote_status', 'in_progress');
                if (order) q = q.order(order.column, { ascending: !!order.ascending });
                if (limit != null) q = q.limit(limit);
                return q;
            });
            return data || [];
        },

        // Activas (no archivadas, sin borradores). Atajo de listForArtist.
        listActiveForArtist(artistUserId, opts = {}) {
            return this.listForArtist(artistUserId, { excludeArchived: true, excludeInProgress: true, ...opts });
        },

        // Archivadas del artista.
        async listArchivedForArtist(artistUserId, select = '*') {
            const { data } = await run('quotations.listArchivedForArtist', (c) =>
                c.from('quotations_db').select(select).eq('artist_id', artistUserId).eq('is_archived', true)
            );
            return data || [];
        },

        // Listado del cliente: propias por user_id o email, no ocultas. FIX
        // (doc §4-B): el email se escapa con orValue para no romper el .or().
        async listForClient(userId, email, select = '*') {
            const { data } = await run('quotations.listForClient', (c) =>
                c.from('quotations_db').select(select)
                    .or(`client_user_id.eq.${userId},client_email.ilike.${orValue(email)}`)
                    .is('client_deleted_at', null)
                    .order('created_at', { ascending: false })
            );
            return data || [];
        },

        // Listado del backoffice; filtro de estado opcional.
        async listForAdmin(opts = {}) {
            const { status = null, select = '*' } = opts;
            const { data } = await run('quotations.listForAdmin', (c) => {
                let q = c.from('quotations_db').select(select).order('created_at', { ascending: false });
                if (status) q = q.eq('quote_status', status);
                return q;
            });
            return data || [];
        },

        // Todas (soporte). Depende de RLS de soporte para alcance.
        async listAll(select = '*') {
            const { data } = await run('quotations.listAll', (c) =>
                c.from('quotations_db').select(select).order('created_at', { ascending: false })
            );
            return data || [];
        },

        // Recientes para dashboard admin.
        async listRecent(limit = 5, select = 'quote_id, client_full_name, artist_name, created_at, quote_status') {
            const { data } = await run('quotations.listRecent', (c) =>
                c.from('quotations_db').select(select).order('created_at', { ascending: false }).limit(limit)
            );
            return data || [];
        },

        // Filas {quote_status} del artista (el caller agrega en JS).
        async statusCountsForArtist(artistUserId) {
            const { data } = await run('quotations.statusCountsForArtist', (c) =>
                c.from('quotations_db').select('quote_status').eq('artist_id', artistUserId).neq('quote_status', 'in_progress')
            );
            return data || [];
        },

        async countAll() {
            const { count } = await run('quotations.countAll', (c) =>
                c.from('quotations_db').select('*', { count: 'exact', head: true })
            );
            return count || 0;
        },

        async countByStatus(status) {
            const { count } = await run('quotations.countByStatus', (c) =>
                c.from('quotations_db').select('*', { count: 'exact', head: true }).eq('quote_status', status)
            );
            return count || 0;
        },

        // ---- updates ----
        async setRating(id, { rating, reason, comment }) {
            await run('quotations.setRating', (c) =>
                c.from('quotations_db').update({ rating, rating_reason: reason, rating_comment: comment }).eq('id', id)
            );
        },
        async updateStatusById(id, newStatus) {
            await run('quotations.updateStatusById', (c) =>
                c.from('quotations_db').update({ quote_status: newStatus }).eq('id', id)
            );
        },
        async updatePriority(id, newPriority) {
            await run('quotations.updatePriority', (c) =>
                c.from('quotations_db').update({ priority: newPriority }).eq('id', id)
            );
        },
        async setArchivedById(id, archived) {
            await run('quotations.setArchivedById', (c) =>
                c.from('quotations_db').update({ is_archived: !!archived }).eq('id', id)
            );
        },
        async setArchivedByIds(ids, archived) {
            await run('quotations.setArchivedByIds', (c) =>
                c.from('quotations_db').update({ is_archived: !!archived }).in('id', ids)
            );
        },
        async updateStatusByIds(ids, newStatus) {
            await run('quotations.updateStatusByIds', (c) =>
                c.from('quotations_db').update({ quote_status: newStatus }).in('id', ids)
            );
        },
        // Campo unico arbitrario (inspector de soporte).
        async updateField(id, field, value) {
            await run('quotations.updateField', (c) =>
                c.from('quotations_db').update({ [field]: value }).eq('id', id)
            );
        },
        // Edicion de detalles del tatuaje / oferta del artista (objeto libre).
        async updateById(id, patch) {
            await run('quotations.updateById', (c) =>
                c.from('quotations_db').update(patch).eq('id', id)
            );
        },

        // ---- deletes (HARD; no confundir con archivar/soft-delete) ----
        async hardDeleteById(id) {
            await run('quotations.hardDeleteById', (c) => c.from('quotations_db').delete().eq('id', id));
        },
        async hardDeleteByIds(ids) {
            await run('quotations.hardDeleteByIds', (c) => c.from('quotations_db').delete().in('id', ids));
        },
        async hardDeleteByQuoteId(quoteId) {
            await run('quotations.hardDeleteByQuoteId', (c) => c.from('quotations_db').delete().eq('quote_id', quoteId));
        },
        async hardDeleteByQuoteIds(quoteIds) {
            await run('quotations.hardDeleteByQuoteIds', (c) => c.from('quotations_db').delete().in('quote_id', quoteIds));
        },

        // ---- wizard (upsert por quote_id) ----
        async upsert(payload) {
            const { data } = await run('quotations.upsert', (c) =>
                c.from('quotations_db').upsert([payload], { onConflict: 'quote_id' })
            );
            return data || [];
        },

        // ---- lookups por email / claim ----
        async findLatestByEmailForReuse(email, select) {
            const cols = select || 'quote_id, client_full_name, client_whatsapp, client_birth_date, client_instagram, client_city_residence, client_contact_preference, client_health_conditions, client_allergies';
            const { data } = await run('quotations.findLatestByEmailForReuse', (c) =>
                c.from('quotations_db').select(cols).ilike('client_email', email).neq('quote_status', 'in_progress').order('created_at', { ascending: false }).limit(1)
            );
            return (data && data[0]) || null;
        },
        async findUnclaimedByEmail(email) {
            const { data } = await run('quotations.findUnclaimedByEmail', (c) =>
                c.from('quotations_db').select('quote_id').ilike('client_email', email).is('client_user_id', null)
            );
            return data || [];
        },
        async claimByQuoteIds(userId, quoteIds) {
            await run('quotations.claimByQuoteIds', (c) =>
                c.from('quotations_db').update({ client_user_id: userId }).in('quote_id', quoteIds)
            );
        },
        async claimByQuoteId(userId, quoteId) {
            await run('quotations.claimByQuoteId', (c) =>
                c.from('quotations_db').update({ client_user_id: userId }).eq('quote_id', quoteId).is('client_user_id', null)
            );
        },
    };

    // ===================== quotation_notes (key = int id) =====================
    const Notes = {
        async listForQuote(quotationId) {
            const { data } = await run('notes.listForQuote', (c) =>
                c.from('quotation_notes').select('*').eq('quotation_id', quotationId).order('note_date', { ascending: false })
            );
            return data || [];
        },
        async create(note) {
            const { data } = await run('notes.create', (c) => c.from('quotation_notes').insert([note]));
            return data || [];
        },
        async update(noteId, patch) {
            await run('notes.update', (c) => c.from('quotation_notes').update(patch).eq('id', noteId));
        },
        async delete(noteId) {
            await run('notes.delete', (c) => c.from('quotation_notes').delete().eq('id', noteId));
        },
    };

    // ===================== quotation_sessions (key = int id) =====================
    const Sessions = {
        async listForQuote(quotationId) {
            const { data } = await run('sessions.listForQuote', (c) =>
                c.from('quotation_sessions').select('*').eq('quotation_id', quotationId).order('session_date', { ascending: true })
            );
            return data || [];
        },
        async listByQuotationIds(quotationIds) {
            const { data } = await run('sessions.listByQuotationIds', (c) =>
                c.from('quotation_sessions').select('*').in('quotation_id', quotationIds).order('session_date', { ascending: true })
            );
            return data || [];
        },
        // Proximas sesiones con datos de la cotizacion embebidos (recurso PostgREST).
        async listUpcomingForArtist(fromIso, opts = {}) {
            const { limit = 20, select } = opts;
            const cols = select || 'id, session_date, session_number, status, notes, quotation_id, quotations_db(client_full_name, tattoo_style, tattoo_body_part)';
            const { data } = await run('sessions.listUpcomingForArtist', (c) =>
                c.from('quotation_sessions').select(cols).gte('session_date', fromIso).order('session_date', { ascending: true }).limit(limit)
            );
            return data || [];
        },
        async create(session) {
            // .select().maybeSingle() devuelve la fila insertada CON el
            // session_number que asigna el trigger server-side (al enviar null).
            // maybeSingle (no single) para que el create NUNCA lance si la policy
            // de SELECT post-insert no devolviera la fila: el insert ya ocurrio.
            const { data } = await run('sessions.create', (c) => c.from('quotation_sessions').insert([session]).select().maybeSingle());
            return data || null;
        },
        async update(sessionId, patch) {
            await run('sessions.update', (c) => c.from('quotation_sessions').update(patch).eq('id', sessionId));
        },
        async updateStatus(sessionId, status) {
            await run('sessions.updateStatus', (c) => c.from('quotation_sessions').update({ status }).eq('id', sessionId));
        },
        async setGoogleEventId(sessionId, googleEventId) {
            await run('sessions.setGoogleEventId', (c) => c.from('quotation_sessions').update({ google_event_id: googleEventId }).eq('id', sessionId));
        },
        async delete(sessionId) {
            await run('sessions.delete', (c) => c.from('quotation_sessions').delete().eq('id', sessionId));
        },
    };

    // ============== quotations_attachments (key = text quote_id) ==============
    const Attachments = {
        async listByQuoteIds(quoteIds) {
            const { data } = await run('attachments.listByQuoteIds', (c) =>
                c.from('quotations_attachments').select('*').in('quotation_id', quoteIds)
            );
            return data || [];
        },
        async insertMany(records) {
            const { data } = await run('attachments.insertMany', (c) =>
                c.from('quotations_attachments').insert(records).select()
            );
            return data || [];
        },
    };

    // ================== chat_messages (key = text quote_id) ==================
    const Chat = {
        async listByQuote(quoteId) {
            const { data } = await run('chat.listByQuote', (c) =>
                c.from('chat_messages').select('*').eq('quotation_id', quoteId).order('created_at', { ascending: true })
            );
            return data || [];
        },
        async sendMessage({ quoteId, senderType, senderId, message }) {
            const { data } = await run('chat.sendMessage', (c) =>
                c.from('chat_messages').insert({ quotation_id: quoteId, sender_type: senderType, sender_id: senderId, message })
            );
            return data || [];
        },
        // Marca como leidos los mensajes NO leidos enviados por `fromSenderType`.
        async markRead(quoteId, fromSenderType) {
            await run('chat.markRead', (c) =>
                c.from('chat_messages').update({ is_read: true }).eq('quotation_id', quoteId).eq('sender_type', fromSenderType).eq('is_read', false)
            );
        },
        async countUnread(quoteId, fromSenderType) {
            const { count } = await run('chat.countUnread', (c) =>
                c.from('chat_messages').select('*', { count: 'exact', head: true }).eq('quotation_id', quoteId).eq('sender_type', fromSenderType).eq('is_read', false)
            );
            return count || 0;
        },
        // FIX (doc §4-F): batch en 1 query en vez de N. Devuelve { quoteId: count }.
        async countUnreadByQuotationIds(quoteIds, fromSenderType) {
            if (!quoteIds || !quoteIds.length) return {};
            const { data } = await run('chat.countUnreadByQuotationIds', (c) =>
                c.from('chat_messages').select('quotation_id').in('quotation_id', quoteIds).eq('sender_type', fromSenderType).eq('is_read', false)
            );
            const counts = {};
            (data || []).forEach((r) => { counts[r.quotation_id] = (counts[r.quotation_id] || 0) + 1; });
            return counts;
        },
    };

    // ===================== realtime =====================
    const Realtime = {
        // Suscribe a INSERT de chat_messages de una cotizacion. Devuelve el canal.
        subscribeChatMessages(channelName, quoteId, onInsert) {
            const client = D.getClient();
            if (!client) return null;
            return client
                .channel(channelName)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `quotation_id=eq.${quoteId}` }, onInsert)
                .subscribe();
        },
        // Suscribe a INSERT de chat_messages de un sender (badges de no leidos).
        subscribeNewChatFromSender(channelName, senderType, onInsert) {
            const client = D.getClient();
            if (!client) return null;
            return client
                .channel(channelName)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `sender_type=eq.${senderType}` }, onInsert)
                .subscribe();
        },
        // Suscribe a UPDATE de quotations_db (sin filtro de fila; RLS acota).
        subscribeQuotationUpdates(channelName, onUpdate) {
            const client = D.getClient();
            if (!client) return null;
            return client
                .channel(channelName)
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quotations_db' }, onUpdate)
                .subscribe();
        },
        // Canal admin con INSERT y UPDATE de quotations_db sobre un mismo canal.
        subscribeQuotationsForAdmin(channelName, { onInsert, onUpdate } = {}) {
            const client = D.getClient();
            if (!client) return null;
            let ch = client.channel(channelName);
            if (onInsert) ch = ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quotations_db' }, onInsert);
            if (onUpdate) ch = ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quotations_db' }, onUpdate);
            return ch.subscribe();
        },
        remove(channel) {
            const client = D.getClient();
            if (client && channel) client.removeChannel(channel);
        },
    };

    // ============ operaciones mediadas por el servidor (Express) ============
    const Api = {
        basePath() {
            if (window.WEOTZI_BASE_PATH) return String(window.WEOTZI_BASE_PATH).replace(/\/$/, '');
            const p = window.location && window.location.pathname || '';
            return p === '/beta' || p.indexOf('/beta/') === 0 ? '/beta' : '';
        },
        async _post(path, accessToken) {
            const res = await fetch(this.basePath() + path, {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.success === false) {
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            return body;
        },
        hideForClient(quoteId, accessToken) {
            return this._post(`/api/client/quotations/${encodeURIComponent(quoteId)}/hide`, accessToken);
        },
        confirmCompletionByClient(quoteId, accessToken) {
            return this._post(`/api/client/quotations/${encodeURIComponent(quoteId)}/complete`, accessToken);
        },
    };

    D.Quotations = Quotations;
    D.Notes = Notes;
    D.Sessions = Sessions;
    D.Attachments = Attachments;
    D.Chat = Chat;
    D.Realtime = Realtime;
    D.Api = Api;
})();
