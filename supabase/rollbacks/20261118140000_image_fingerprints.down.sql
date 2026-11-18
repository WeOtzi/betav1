-- Reversa de 20261118140000_image_fingerprints.sql (huellas de imágenes).
--
-- Corre ANTES que la reversa de 20261118130000_account_sanctions (la función
-- image_fp_record_alert depende del tipo de fila de security_alerts).
--
-- Se pierden las huellas calculadas (también la prueba de antigüedad de las
-- imágenes borradas), la cola y el registro de búsquedas. Las alertas
-- image_duplicate ya creadas en security_alerts se conservan.

begin;

-- 1. Triggers de la marca de «sucio».
drop trigger if exists trg_image_fp_dirty_artists_upd on public.artists_db;
drop trigger if exists trg_image_fp_dirty_artists_ins_del on public.artists_db;
drop trigger if exists trg_image_fp_dirty_studios_upd on public.studios;
drop trigger if exists trg_image_fp_dirty_studios_ins_del on public.studios;
drop trigger if exists trg_image_fp_dirty_store_products_upd on public.store_products;
drop trigger if exists trg_image_fp_dirty_store_products_ins_del on public.store_products;
drop trigger if exists trg_image_fp_dirty_store_design_assets on public.store_design_assets;

-- 2. Funciones.
drop function if exists public.image_fp_record_alert(uuid, uuid, jsonb);
drop function if exists public.image_fp_storage_created_at(text, text[]);
drop function if exists private.image_fp_storage_created_at(text, text[]);
drop function if exists public.image_fp_candidates(bit, bit, integer, uuid);
drop function if exists public.search_image_fingerprints(bit, bit, integer, integer);
drop function if exists private.image_fp_mark_dirty();

-- 3. Índice de una alerta por par.
drop index if exists public.security_alerts_image_pair_key;

-- 4. Tablas (con sus políticas, índices y el trigger de updated_at).
drop table if exists public.design_search_log;
drop table if exists public.image_fingerprint_queue;
drop table if exists public.image_fingerprints;

commit;
