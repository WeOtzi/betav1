-- Reversa de supabase/migrations/20261028130000_quotation_detail_figma.sql
-- Quita la duración por sesión, las fotos de sesión, las disputas y el bucket
-- de fotos. Los datos cargados se pierden; el frontend degrada solo (el
-- expediente oculta duración/fotos/disputa y reintenta los updates sin esas
-- columnas). quotations_db.dispute_status (previa) NO se toca.
-- Los objetos del bucket deben vaciarse antes (Storage API); si quedan objetos,
-- el delete del bucket falla y la reversa se aborta sin cambios parciales.

begin;

drop policy if exists "quotation_session_photos_owner_select" on storage.objects;
drop policy if exists "quotation_session_photos_owner_insert" on storage.objects;
drop policy if exists "quotation_session_photos_owner_delete" on storage.objects;
delete from storage.buckets where id = 'quotation-session-photos';

drop trigger if exists trg_quotation_disputes_sync_status on public.quotation_disputes;
drop trigger if exists trg_quotation_disputes_guard on public.quotation_disputes;
drop function if exists public.fn_quotation_disputes_sync_status();
drop function if exists public.fn_quotation_disputes_guard();
drop table if exists public.quotation_disputes;

alter table public.quotation_sessions
  drop constraint if exists quotation_sessions_photo_urls_len;
alter table public.quotation_sessions
  drop column if exists photo_urls;

alter table public.quotations_db
  drop constraint if exists quotations_db_artist_session_minutes_check;
alter table public.quotations_db
  drop column if exists artist_session_minutes,
  drop column if exists artist_viewed_at;

commit;
