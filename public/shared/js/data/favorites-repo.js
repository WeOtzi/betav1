/**
 * WE OTZI - Repositorio de Favoritos del cliente (frontend)
 * ---------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js).
 *
 * Ronda 2 (P22): los favoritos viven en LISTAS — tablas `favorite_lists` y
 * `favorite_items` (migracion 20261116190000). RLS de dueño: cada persona solo
 * ve y toca lo suyo. Soporte puede LEER todo, por eso cada consulta filtra por
 * `owner_user_id` (si no, una cuenta de soporte veria listas ajenas).
 *
 *   WeotziData.FavoriteLists  listas + items (lo usan wo-favorites.js y
 *                             /client/favorites) y los contadores publicos.
 *   WeotziData.Favorites      API anterior (corazon de artistas del
 *                             marketplace): mismas firmas, ahora lee y escribe
 *                             las listas. Si la migracion todavia no esta
 *                             aplicada cae a `client_favorites`, que la base
 *                             mantiene como espejo.
 *
 * Carga: DESPUES de postgrest-client.js.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[favorites-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    const LIST_COLS = 'id, name, is_default, sort_order, created_at';
    const ITEM_COLS = 'id, list_id, kind, target_id, label, image_url, url, artist_user_id, created_at';
    const MAX_ROWS = 5000;

    function codeOf(err) { return String((err && (err.code || (err.cause && err.cause.code))) || ''); }

    // La base todavia no tiene las tablas/funciones nuevas (deploy sin migracion).
    function isMissingSchema(err) {
        const code = codeOf(err);
        if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') return true;
        const text = String((err && err.message) || '') + ' ' + String((err && err.cause && err.cause.message) || '');
        return /favorite_(lists|items)|favorites_(save|default_list_id)/i.test(text)
            && /does not exist|could not find|schema cache/i.test(text);
    }

    // ------------------------------------------------------------------
    // Listas de favoritos
    // ------------------------------------------------------------------
    const FavoriteLists = {
        LIST_COLS,
        ITEM_COLS,
        isMissingSchema,

        // Listas del usuario: la de defecto primero, despues por orden.
        async listLists(userId) {
            const { data } = await run('favoriteLists.listLists', (c) =>
                c.from('favorite_lists')
                    .select(LIST_COLS)
                    .eq('owner_user_id', userId)
                    .order('is_default', { ascending: false })
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: true })
            );
            return data || [];
        },

        // Todo lo guardado por el usuario (todas sus listas), mas reciente primero.
        async listItems(userId) {
            const { data } = await run('favoriteLists.listItems', (c) =>
                c.from('favorite_items')
                    .select(ITEM_COLS)
                    .eq('owner_user_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(MAX_ROWS)
            );
            return data || [];
        },

        // Id de la lista por defecto ("Favoritos"); la crea si falta.
        async ensureDefaultList() {
            const { data } = await run('favoriteLists.ensureDefaultList', (c) => c.rpc('favorites_default_list_id'));
            return data || null;
        },

        // Guarda (o refresca el snapshot de) un favorito. Sin listId va a la
        // lista por defecto. item: { kind, id, label, image, url, artistId }.
        // Devuelve la fila de favorite_items.
        async save(item, listId) {
            const it = item || {};
            const { data } = await run('favoriteLists.save', (c) =>
                c.rpc('favorites_save', {
                    p_kind: it.kind,
                    p_target_id: it.id,
                    p_label: it.label || null,
                    p_image_url: it.image || null,
                    p_url: it.url || null,
                    p_artist_user_id: it.artistId || null,
                    p_list_id: listId || null,
                })
            );
            return Array.isArray(data) ? (data[0] || null) : (data || null);
        },

        // Quita un guardado puntual (una fila).
        async removeItem(userId, itemId) {
            await run('favoriteLists.removeItem', (c) =>
                c.from('favorite_items').delete().eq('id', itemId).eq('owner_user_id', userId)
            );
            return true;
        },

        // Quita un destino de una lista o, sin listId, de todas las del usuario.
        async removeTarget(userId, kind, targetId, listId) {
            await run('favoriteLists.removeTarget', (c) => {
                let q = c.from('favorite_items').delete()
                    .eq('owner_user_id', userId).eq('kind', kind).eq('target_id', targetId);
                if (listId) q = q.eq('list_id', listId);
                return q;
            });
            return true;
        },

        // Mueve un guardado a otra lista. Si en el destino ya estaba, se quita
        // el de origen (queda uno solo). Devuelve { row, merged }.
        async moveItem(userId, itemId, listId) {
            try {
                const { data } = await run('favoriteLists.moveItem', (c) =>
                    c.from('favorite_items').update({ list_id: listId })
                        .eq('id', itemId).eq('owner_user_id', userId)
                        .select(ITEM_COLS)
                );
                return { row: (data && data[0]) || null, merged: false };
            } catch (err) {
                if (codeOf(err) !== '23505') throw err;
                await this.removeItem(userId, itemId);
                return { row: null, merged: true };
            }
        },

        async createList(userId, name, sortOrder) {
            const { data } = await run('favoriteLists.createList', (c) =>
                c.from('favorite_lists')
                    .insert({ owner_user_id: userId, name, sort_order: Number(sortOrder) || 0 })
                    .select(LIST_COLS)
            );
            return (data && data[0]) || null;
        },

        async renameList(userId, listId, name) {
            const { data } = await run('favoriteLists.renameList', (c) =>
                c.from('favorite_lists').update({ name })
                    .eq('id', listId).eq('owner_user_id', userId)
                    .select(LIST_COLS)
            );
            return (data && data[0]) || null;
        },

        // Borra una lista con todo lo que tiene. La de defecto no se borra
        // (la politica de la base tampoco lo permite). Devuelve true si se borro.
        async deleteList(userId, listId) {
            const { data } = await run('favoriteLists.deleteList', (c) =>
                c.from('favorite_lists').delete()
                    .eq('id', listId).eq('owner_user_id', userId).eq('is_default', false)
                    .select('id')
            );
            return !!(data && data.length);
        },

        // Contador publico "veces guardado" por artista (lo usa Most Wanted).
        // → [{ artist_user_id, saved_count, items_saved_count }]
        async artistSaveCounts(artistUserIds) {
            const ids = (Array.isArray(artistUserIds) ? artistUserIds : [artistUserIds]).filter(Boolean).slice(0, 200);
            if (!ids.length) return [];
            const { data } = await run('favoriteLists.artistSaveCounts', (c) =>
                c.rpc('favorite_artist_save_counts', { p_artist_user_ids: ids })
            );
            return data || [];
        },

        // Contador publico por destino. → [{ target_id, saved_count }]
        async targetSaveCounts(kind, targetIds) {
            const ids = (Array.isArray(targetIds) ? targetIds : [targetIds]).filter(Boolean).map(String).slice(0, 200);
            if (!ids.length) return [];
            const { data } = await run('favoriteLists.targetSaveCounts', (c) =>
                c.rpc('favorite_target_save_counts', { p_kind: kind, p_target_ids: ids })
            );
            return data || [];
        },
    };

    // ------------------------------------------------------------------
    // API anterior: artistas favoritos del cliente (marketplace)
    // ------------------------------------------------------------------
    const Legacy = {
        async listByClient(clientUserId) {
            const { data } = await run('favorites.listByClient', (c) =>
                c.from('client_favorites')
                    .select('artist_user_id, created_at')
                    .eq('client_user_id', clientUserId)
                    .order('created_at', { ascending: false })
            );
            return data || [];
        },
        async add(clientUserId, artistUserId) {
            const { data } = await run('favorites.add', (c) =>
                c.from('client_favorites')
                    .upsert(
                        { client_user_id: clientUserId, artist_user_id: artistUserId },
                        { onConflict: 'client_user_id,artist_user_id' }
                    )
                    .select('artist_user_id, created_at')
            );
            return (data && data[0]) || null;
        },
        async remove(clientUserId, artistUserId) {
            await run('favorites.remove', (c) =>
                c.from('client_favorites')
                    .delete()
                    .eq('client_user_id', clientUserId)
                    .eq('artist_user_id', artistUserId)
            );
            return true;
        },
    };

    const Favorites = {
        // Artistas guardados en CUALQUIER lista del cliente, mas recientes
        // primero. Devuelve filas { artist_user_id, created_at } sin repetir.
        async listByClient(clientUserId) {
            let rows;
            try {
                const { data } = await run('favorites.listByClient', (c) =>
                    c.from('favorite_items')
                        .select('target_id, created_at')
                        .eq('owner_user_id', clientUserId)
                        .eq('kind', 'artist')
                        .order('created_at', { ascending: false })
                        .limit(MAX_ROWS)
                );
                rows = data || [];
            } catch (err) {
                if (!isMissingSchema(err)) throw err;
                return Legacy.listByClient(clientUserId);
            }
            const seen = new Set();
            return rows.reduce((out, row) => {
                if (row && row.target_id && !seen.has(row.target_id)) {
                    seen.add(row.target_id);
                    out.push({ artist_user_id: row.target_id, created_at: row.created_at });
                }
                return out;
            }, []);
        },

        // Alta idempotente en la lista por defecto. snapshot (opcional):
        // { label, image, url } para pintarlo en "Mis favoritos".
        async add(clientUserId, artistUserId, snapshot) {
            const s = snapshot || {};
            try {
                const row = await FavoriteLists.save({
                    kind: 'artist', id: artistUserId, label: s.label, image: s.image, url: s.url,
                });
                return row ? { artist_user_id: row.target_id, created_at: row.created_at } : null;
            } catch (err) {
                if (!isMissingSchema(err)) throw err;
                return Legacy.add(clientUserId, artistUserId);
            }
        },

        // Baja: sale de todas las listas. Borrar algo que no existe no es error.
        async remove(clientUserId, artistUserId) {
            try {
                return await FavoriteLists.removeTarget(clientUserId, 'artist', String(artistUserId || '').toLowerCase());
            } catch (err) {
                if (!isMissingSchema(err)) throw err;
                return Legacy.remove(clientUserId, artistUserId);
            }
        },

        // Alterna segun el estado actual conocido por el caller y devuelve el
        // estado final (true = quedo como favorito).
        async toggle(clientUserId, artistUserId, isFavorite) {
            if (isFavorite) {
                await this.remove(clientUserId, artistUserId);
                return false;
            }
            await this.add(clientUserId, artistUserId);
            return true;
        },
    };

    window.WeotziData.FavoriteLists = FavoriteLists;
    window.WeotziData.Favorites = Favorites;
})();
