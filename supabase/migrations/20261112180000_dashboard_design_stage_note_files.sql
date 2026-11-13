-- Dashboard del artista · ronda 3 (12 nov 2026) · grupo "dashboard".
-- Figma w3JA83CcP5ISKjyOu87mx1 · 24:1425 (Diseños en proceso) y 801:578/579
-- (notas de trabajo, bloque IMAGEN).
--
-- 1. quotations_db.design_stage ('boceto' | 'entintado' | 'final') y
--    quotations_db.design_due_date: etapa y fecha límite del diseño que el
--    Figma muestra en la tarjeta. No se reutiliza current_step (es el paso del
--    wizard del cliente).
-- 2. RPC public.set_quotation_design_stage(p_quotation_id, p_stage, p_due_date):
--    security definer; solo el artista dueño de la cotización (o soporte) la
--    cambia, y solo esas dos columnas.
-- 3. Bucket privado quotation-note-files para las imágenes de las notas de
--    trabajo. Ruta: <artist_id>/<quotation_id>/<archivo>. El artista dueño de
--    la cotización sube, lee y borra; soporte lee. El cliente nunca las ve (las
--    notas son privadas).
--
-- Aditiva e idempotente. Reversa:
-- supabase/rollbacks/20261112180000_dashboard_design_stage_note_files.down.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Etapa y fecha límite del diseño
-- ---------------------------------------------------------------------------
alter table public.quotations_db
  add column if not exists design_stage text,
  add column if not exists design_due_date date;

alter table public.quotations_db
  drop constraint if exists quotations_db_design_stage_check;
alter table public.quotations_db
  add constraint quotations_db_design_stage_check
  check (design_stage is null or design_stage in ('boceto', 'entintado', 'final'));

comment on column public.quotations_db.design_stage is
  'Etapa del diseño (boceto, entintado, final) que el artista marca en el dashboard. Se escribe con set_quotation_design_stage.';
comment on column public.quotations_db.design_due_date is
  'Fecha límite del diseño que muestra la tarjeta de Diseños en proceso. Se escribe con set_quotation_design_stage.';

-- ---------------------------------------------------------------------------
-- 2. RPC de escritura (solo el artista dueño o soporte)
-- ---------------------------------------------------------------------------
create or replace function public.set_quotation_design_stage(
  p_quotation_id integer,
  p_stage text,
  p_due_date date default null
)
returns table (id integer, quote_id text, design_stage text, design_due_date date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_stage text := nullif(lower(btrim(coalesce(p_stage, ''))), '');
  v_artist uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión.' using errcode = '42501';
  end if;

  if v_stage is not null and v_stage not in ('boceto', 'entintado', 'final') then
    raise exception 'Etapa inválida: %', p_stage using errcode = '22023';
  end if;

  if p_due_date is not null
     and (p_due_date < date '2000-01-01' or p_due_date > (current_date + interval '5 years')::date) then
    raise exception 'Fecha límite fuera de rango.' using errcode = '22023';
  end if;

  select q.artist_id, q.quote_status::text
    into v_artist, v_status
    from public.quotations_db q
   where q.id = p_quotation_id
   for update;

  if not found then
    raise exception 'La cotización no existe.' using errcode = 'P0002';
  end if;

  if v_artist is distinct from v_uid and not coalesce(public.is_support_user(), false) then
    raise exception 'Solo el artista de la cotización puede cambiar la etapa.' using errcode = '42501';
  end if;

  -- Borradores del cliente y cotizaciones cerradas sin trabajo no tienen diseño.
  if v_status in ('in_progress', 'client_rejected') then
    raise exception 'Esta cotización no tiene un diseño en proceso.' using errcode = '22023';
  end if;

  return query
  update public.quotations_db q
     set design_stage = v_stage,
         design_due_date = p_due_date
   where q.id = p_quotation_id
  returning q.id, q.quote_id::text, q.design_stage, q.design_due_date;
end;
$$;

revoke all on function public.set_quotation_design_stage(integer, text, date) from public;
revoke all on function public.set_quotation_design_stage(integer, text, date) from anon;
grant execute on function public.set_quotation_design_stage(integer, text, date) to authenticated, service_role;

comment on function public.set_quotation_design_stage(integer, text, date) is
  'Dashboard del artista (Figma 24:1425): guarda etapa y fecha límite del diseño. Solo el artista dueño o soporte.';

-- ---------------------------------------------------------------------------
-- 3. Bucket privado de imágenes de notas de trabajo
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quotation-note-files',
  'quotation-note-files',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quotation_note_files_owner_select" on storage.objects;
create policy "quotation_note_files_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'quotation-note-files'
    and ((storage.foldername(name))[1] = (select auth.uid())::text
         or (select public.is_support_user())));

drop policy if exists "quotation_note_files_owner_insert" on storage.objects;
create policy "quotation_note_files_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'quotation-note-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.quotations_db q
       where q.id::text = (storage.foldername(name))[2]
         and q.artist_id = (select auth.uid())
    ));

drop policy if exists "quotation_note_files_owner_delete" on storage.objects;
create policy "quotation_note_files_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'quotation-note-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
