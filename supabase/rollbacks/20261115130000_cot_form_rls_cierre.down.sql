-- Reversa de 20261115130000_cot_form_rls_cierre.sql. Vuelve a abrir las
-- políticas legacy del intake tal como estaban en la base viva (2026-11-14).
-- OJO: reabre la lectura/escritura anónima de cotizaciones 'in_progress';
-- usar solo si el wizard viejo (inserts de adjuntos desde el navegador)
-- vuelve a producción.

begin;

-- 5. Bucket quotation-references
drop policy if exists "Public Insert for quotation-references" on storage.objects;
create policy "Public Insert for quotation-references" on storage.objects
  for insert to public
  with check (bucket_id = 'quotation-references');

drop function if exists private.is_open_web_quote_draft(text);

update storage.buckets
   set file_size_limit = null,
       allowed_mime_types = null
 where id = 'quotation-references';

-- 4. quotations_attachments
drop policy if exists attachments_parties_insert on public.quotations_attachments;
drop policy if exists attachments_public_insert on public.quotations_attachments;
create policy attachments_public_insert on public.quotations_attachments
  for insert to anon, authenticated
  with check (true);

drop policy if exists attachments_select_visible on public.quotations_attachments;
create policy attachments_select_visible on public.quotations_attachments
  for select to anon, authenticated
  using (
    is_support_user()
    or exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotations_attachments.quotation_id
         and (q.quote_status::text = 'in_progress' or q.client_user_id = auth.uid() or q.artist_id = auth.uid())
    )
  );

-- 3. quotation_intake_extras
drop policy if exists qie_select_parties on public.quotation_intake_extras;
drop policy if exists qie_update_draft_or_parties on public.quotation_intake_extras;
drop policy if exists qie_insert_open on public.quotation_intake_extras;
create policy qie_insert_open on public.quotation_intake_extras
  for insert to public
  with check (true);
create policy qie_select_parties on public.quotation_intake_extras
  for select to public
  using (
    exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotation_intake_extras.quote_id
         and (q.quote_status::text = 'in_progress' or q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
    or is_support_user()
  );
create policy qie_update_draft_or_parties on public.quotation_intake_extras
  for update to public
  using (
    exists (
      select 1 from public.quotations_db q
       where q.quote_id::text = quotation_intake_extras.quote_id
         and (q.quote_status::text = 'in_progress' or q.artist_id = (select auth.uid()) or q.client_user_id = (select auth.uid()))
    )
    or is_support_user()
  );

-- 2. quotation_status_history
drop policy if exists "Allow anon insert on status history" on public.quotation_status_history;
create policy "Allow anon insert on status history" on public.quotation_status_history
  for insert to anon
  with check (true);

-- 1. quotations_db
drop trigger if exists trg_a_quotations_client_column_guard on public.quotations_db;
drop function if exists public.fn_quotations_client_column_guard();

grant truncate, references, trigger on public.quotations_db to anon, authenticated;

drop policy if exists "Allow all insert quotations" on public.quotations_db;
create policy "Allow all insert quotations" on public.quotations_db
  for insert to public
  with check (true);

drop policy if exists "Allow anon select in_progress" on public.quotations_db;
create policy "Allow anon select in_progress" on public.quotations_db
  for select to anon
  using (quote_status::text = 'in_progress');

drop policy if exists "Allow anon update in_progress quotations" on public.quotations_db;
create policy "Allow anon update in_progress quotations" on public.quotations_db
  for update to anon, authenticated
  using (quote_status::text = 'in_progress')
  with check (quote_status::text = any (array['in_progress'::varchar, 'pending'::varchar]));

commit;
