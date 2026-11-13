-- Reversa de supabase/migrations/20261112180000_dashboard_design_stage_note_files.sql
-- (etapa y fecha límite del diseño + bucket de imágenes de notas de trabajo).
-- Storage bloquea los DELETE por SQL (storage.protect_delete) salvo con
-- storage.allow_delete_query = 'true' en la transacción. Solo se habilita para
-- borrar el bucket si está VACÍO; las imágenes que hubiera no se tocan (vaciarlo
-- antes con la Storage API y volver a correr esta reversa). Las columnas se
-- quitan con sus datos.
begin;

drop policy if exists "quotation_note_files_owner_select" on storage.objects;
drop policy if exists "quotation_note_files_owner_insert" on storage.objects;
drop policy if exists "quotation_note_files_owner_delete" on storage.objects;
set local storage.allow_delete_query = 'true';
delete from storage.buckets
 where id = 'quotation-note-files'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'quotation-note-files');

drop function if exists public.set_quotation_design_stage(integer, text, date);

alter table public.quotations_db drop constraint if exists quotations_db_design_stage_check;
alter table public.quotations_db
  drop column if exists design_stage,
  drop column if exists design_due_date;

commit;
