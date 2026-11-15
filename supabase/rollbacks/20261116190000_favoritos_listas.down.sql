-- Reversa de 20261116190000_favoritos_listas.sql (ronda 2 · favoritos, P22).
--
-- client_favorites NO se toca y queda completa: mientras la migración estuvo
-- aplicada, los triggers la mantuvieron como espejo de los artistas guardados
-- en cualquier lista. Se pierden las listas y los diseños, merch y estudios
-- guardados (no tienen equivalente en el modelo anterior).
--
-- DROP TABLE no dispara los triggers de fila, así que borrar favorite_items
-- no vacía client_favorites.

begin;

drop trigger if exists trg_client_favorites_sync_lists on public.client_favorites;
drop function if exists private.client_favorites_sync_lists();

drop function if exists public.favorite_artist_save_counts(uuid[]);
drop function if exists public.favorite_target_save_counts(text, text[]);
-- favorites_save devuelve public.favorite_items: se borra antes que la tabla.
drop function if exists public.favorites_save(text, text, text, text, text, uuid, uuid);
drop function if exists public.favorites_default_list_id();

drop table if exists public.favorite_items;
drop table if exists public.favorite_lists;

drop function if exists private.favorite_items_sync_legacy();
drop function if exists private.favorite_items_guard();
drop function if exists private.favorite_lists_guard();
drop function if exists private.favorite_artist_snapshot(uuid);

commit;
