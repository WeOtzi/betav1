-- Reversa de supabase/migrations/20261030203000_studio_finance.sql (M4)
-- Deshace todo en orden inverso. Correr DESPUÉS de revertir M5
-- (20261030204000, que agrega la FK de supply_order_id) y ANTES de M3.
--
-- Storage: restaura EXACTAMENTE las 10 policies vivas previas de
-- studio-documents, studio-photos y studio-spot-attachments (pg_policies en
-- flbgmlvfiejfttlawnfu, 2026-10-30), incluido su defecto original: comparan
-- storage.foldername(s.name) del estudio en lugar del nombre del objeto.
-- Las lecturas *_authenticated_read nunca se tocaron.
--
-- Datos: se pierde el libro public.studio_finance_entries (los comprobantes
-- subidos a studio-documents/<studio_id>/finance/ quedan en el bucket).

begin;

-- ---------------------------------------------------------------------
-- Storage: policies vivas previas
-- ---------------------------------------------------------------------
drop policy if exists studio_spot_atts_owner_delete on storage.objects;
create policy studio_spot_atts_owner_delete on storage.objects
  for delete to public
  using (((bucket_id = 'studio-spot-attachments'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_spot_atts_owner_update on storage.objects;
create policy studio_spot_atts_owner_update on storage.objects
  for update to public
  using (((bucket_id = 'studio-spot-attachments'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_spot_atts_owner_write on storage.objects;
create policy studio_spot_atts_owner_write on storage.objects
  for insert to public
  with check (((bucket_id = 'studio-spot-attachments'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_photos_owner_delete on storage.objects;
create policy studio_photos_owner_delete on storage.objects
  for delete to public
  using (((bucket_id = 'studio-photos'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_photos_owner_update on storage.objects;
create policy studio_photos_owner_update on storage.objects
  for update to public
  using (((bucket_id = 'studio-photos'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_photos_owner_write on storage.objects;
create policy studio_photos_owner_write on storage.objects
  for insert to public
  with check (((bucket_id = 'studio-photos'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_documents_owner_delete on storage.objects;
create policy studio_documents_owner_delete on storage.objects
  for delete to public
  using (((bucket_id = 'studio-documents'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_documents_owner_update on storage.objects;
create policy studio_documents_owner_update on storage.objects
  for update to public
  using (((bucket_id = 'studio-documents'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_documents_owner_read on storage.objects;
create policy studio_documents_owner_read on storage.objects
  for select to public
  using (((bucket_id = 'studio-documents'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop policy if exists studio_documents_owner_write on storage.objects;
create policy studio_documents_owner_write on storage.objects
  for insert to public
  with check (((bucket_id = 'studio-documents'::text) AND (auth.uid() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM public.studios s
  WHERE (((s.id)::text = (storage.foldername(s.name))[1]) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.support_users_db su
  WHERE ((su.user_id = auth.uid()) AND (su.is_active = true)))))));

drop function if exists private.can_manage_studio_storage_path(text);

-- ---------------------------------------------------------------------
-- Finanzas
-- ---------------------------------------------------------------------
drop view if exists public.studio_finance_monthly_by_category;

drop table if exists public.studio_finance_entries;

drop function if exists private.guard_finance_entry_write();
drop function if exists public.set_studio_finance_entries_updated_at();

notify pgrst, 'reload schema';
commit;
