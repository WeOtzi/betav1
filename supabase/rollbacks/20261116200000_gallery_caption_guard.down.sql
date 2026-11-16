-- Reversa de 20261116200000_gallery_caption_guard.sql (ronda 2 · registro).
-- Quita los triggers y las funciones de limpieza del pie de foto. Los pies ya
-- guardados quedan como están (son una clave más del jsonb de cada ítem).

drop trigger if exists artists_db_gallery_caption_guard on public.artists_db;
drop trigger if exists studios_photo_caption_guard on public.studios;

drop function if exists public.artists_db_gallery_caption_guard();
drop function if exists public.studios_photo_caption_guard();
drop function if exists public.wo_normalize_feed_captions(jsonb);
drop function if exists public.wo_clean_gallery_caption(text);
