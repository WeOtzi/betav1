/**
 * Ronda 2 · Inbox — repositorio de mensajes rápidos y respuestas automáticas.
 *
 *   WeotziData.QuickReplies       plantillas del usuario (P9 · rápidos)
 *     · artista: artist_message_templates con kind = 'chat' (tabla compartida
 *       con el frente cot-respuesta, que usa kind = 'quote').
 *     · cliente: client_message_templates.
 *   WeotziData.InboxAutomations   saludo y ausencia del artista (P9 · automáticos)
 *     · artist_inbox_automations (una fila por artista) y el estado actual
 *       calculado por la base (get_inbox_automation_status).
 *
 * Migraciones 20261116160100 y 20261116160200. RLS de dueño en todo: cada
 * usuario lee y escribe solo lo suyo. Debe cargarse después de
 * postgrest-client.js e inbox-extras-model.js.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[inbox-extras-repo] postgrest-client.js debe cargarse antes.');
        return;
    }

    const X = window.WeotziInboxExtras;
    const COLUMNS = 'id,title,body,sort,created_at';

    function source(role) {
        if (X && X.quickSource) return X.quickSource(role);
        return role === 'client'
            ? { table: 'client_message_templates', kind: null }
            : { table: 'artist_message_templates', kind: 'chat' };
    }

    const QuickReplies = {
        async list(role, userId) {
            const src = source(role);
            const { data } = await D.run('quickReplies.list', (c) => {
                let query = c.from(src.table).select(COLUMNS).eq('user_id', userId);
                if (src.kind) query = query.eq('kind', src.kind);
                return query.order('sort', { ascending: true }).order('created_at', { ascending: true }).limit(60);
            });
            return data || [];
        },

        async create(role, userId, { title, body, sort = 0 }) {
            const src = source(role);
            const row = { user_id: userId, title, body, sort };
            if (src.kind) row.kind = src.kind;
            const { data } = await D.run('quickReplies.create', (c) =>
                c.from(src.table).insert(row).select(COLUMNS)
            );
            return Array.isArray(data) ? (data[0] || null) : data;
        },

        async update(role, userId, id, { title, body }) {
            const src = source(role);
            const { data } = await D.run('quickReplies.update', (c) => {
                let query = c.from(src.table).update({ title, body }).eq('id', id).eq('user_id', userId);
                if (src.kind) query = query.eq('kind', src.kind);
                return query.select(COLUMNS);
            });
            return Array.isArray(data) ? (data[0] || null) : data;
        },

        async remove(role, userId, id) {
            const src = source(role);
            await D.run('quickReplies.remove', (c) => {
                let query = c.from(src.table).delete().eq('id', id).eq('user_id', userId);
                if (src.kind) query = query.eq('kind', src.kind);
                return query;
            });
        },

        // changes: [{ id, sort }] (solo las filas que cambiaron de lugar).
        async reorder(role, userId, changes) {
            const src = source(role);
            await Promise.all((changes || []).map((change) =>
                D.run('quickReplies.reorder', (c) => {
                    let query = c.from(src.table).update({ sort: change.sort }).eq('id', change.id).eq('user_id', userId);
                    if (src.kind) query = query.eq('kind', src.kind);
                    return query;
                })
            ));
        },
    };

    const AUTOMATION_COLUMNS = 'user_id,greeting_enabled,greeting_body,away_enabled,away_off_hours,away_vacation,away_body,away_vacation_body,updated_at';

    const InboxAutomations = {
        async get(userId) {
            const { data } = await D.run('inboxAutomations.get', (c) =>
                c.from('artist_inbox_automations').select(AUTOMATION_COLUMNS).eq('user_id', userId).maybeSingle()
            );
            return data || null;
        },

        async save(userId, value) {
            const row = Object.assign({}, value, { user_id: userId });
            const { data } = await D.run('inboxAutomations.save', (c) =>
                c.from('artist_inbox_automations').upsert(row, { onConflict: 'user_id' }).select(AUTOMATION_COLUMNS)
            );
            return Array.isArray(data) ? (data[0] || null) : data;
        },

        // { away, reason, vacation_end, open_until, next_open, has_schedule, timezone }
        async status() {
            const { data } = await D.run('inboxAutomations.status', (c) =>
                c.rpc('get_inbox_automation_status')
            );
            return data || null;
        },
    };

    D.QuickReplies = QuickReplies;
    D.InboxAutomations = InboxAutomations;
})();
