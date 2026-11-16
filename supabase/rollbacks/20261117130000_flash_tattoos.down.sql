-- Reversa de 20261117130000_flash_tattoos.sql (Flash Tattoos).
-- Quita los triggers y las funciones de disponibilidad y de guarda, la columna
-- flash_snapshot y vuelve al CHECK de origen sin 'flash'. El CHECK se crea
-- NOT VALID para no fallar si ya hay cotizaciones de flash: esas filas quedan
-- (con su origen), pero no se pueden crear nuevas. Los datos "flash" dentro de
-- artists_db.gallery_feed_items quedan como están (son una clave más del jsonb).

begin;

drop trigger if exists trg_quotations_flash_availability on public.quotations_db;
drop trigger if exists trg_quotations_flash_guard on public.quotations_db;

drop function if exists public.fn_quotations_flash_availability();
drop function if exists public.fn_flash_set_available(uuid, text, boolean);
drop function if exists public.fn_quotations_flash_guard();

drop index if exists public.quotations_db_flash_item_idx;
alter table public.quotations_db
  drop constraint if exists quotations_db_flash_snapshot_check;
alter table public.quotations_db
  drop column if exists flash_snapshot;

alter table public.quotations_db
  drop constraint if exists quotations_db_source_check;
alter table public.quotations_db
  add constraint quotations_db_source_check
  check (source is null or source = any (array[
    'direct'::text, 'job_board'::text, 'recommendation'::text, 'web_chat'::text,
    'manual'::text, 'prequote'::text
  ])) not valid;

notify pgrst, 'reload schema';

commit;
