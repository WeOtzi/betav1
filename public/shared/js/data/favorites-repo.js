/**
 * WE OTZI - Repositorio de Favoritos del cliente (frontend)
 * ---------------------------------------------------------
 * Metodos con nombre sobre la capa PostgREST unificada (postgrest-client.js)
 * para la tabla `client_favorites` (migracion 20260825160000): corazones del
 * marketplace/explore. PK compuesta (client_user_id, artist_user_id) + RLS
 * owner: cada cliente solo ve y toca sus propias filas.
 *
 * Carga: DESPUES de postgrest-client.js. Expone window.WeotziData.Favorites.
 */
(function () {
    'use strict';

    const D = window.WeotziData;
    if (!D || typeof D.run !== 'function') {
        console.error('[favorites-repo] postgrest-client.js debe cargarse antes.');
        return;
    }
    const run = D.run;

    const Favorites = {
        // Favoritos del cliente, mas recientes primero. Devuelve las filas
        // completas ({ artist_user_id, created_at }); el caller arma su Set.
        async listByClient(clientUserId) {
            const { data } = await run('favorites.listByClient', (c) =>
                c.from('client_favorites')
                    .select('artist_user_id, created_at')
                    .eq('client_user_id', clientUserId)
                    .order('created_at', { ascending: false })
            );
            return data || [];
        },

        // Alta idempotente: la PK compuesta hace que repetir no duplique
        // (upsert sobre el par cliente+artista).
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

        // Baja; borrar algo que no existe no es error.
        async remove(clientUserId, artistUserId) {
            await run('favorites.remove', (c) =>
                c.from('client_favorites')
                    .delete()
                    .eq('client_user_id', clientUserId)
                    .eq('artist_user_id', artistUserId)
            );
            return true;
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

    window.WeotziData.Favorites = Favorites;
})();
