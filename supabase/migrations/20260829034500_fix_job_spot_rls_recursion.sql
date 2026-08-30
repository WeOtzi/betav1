-- Evita recursión RLS entre solicitudes y postulaciones de Job Board / Spots.
-- Las funciones conservan la misma regla (el artista sólo puede ver un contexto
-- al que se postuló) pero la comprobación interna no vuelve a evaluar RLS.

create or replace function public.is_job_board_request_applicant(
  p_request_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_board_applications a
    where a.request_id = p_request_id
      and a.artist_id = p_user_id
  );
$$;

revoke all on function public.is_job_board_request_applicant(uuid, uuid) from public;
grant execute on function public.is_job_board_request_applicant(uuid, uuid) to anon, authenticated;

drop policy if exists "Artists can view requests they applied to" on public.job_board_requests;
create policy "Artists can view requests they applied to"
on public.job_board_requests
for select
using (public.is_job_board_request_applicant(id, (select auth.uid())));

create or replace function public.is_studio_spot_applicant(
  p_spot_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.studio_spot_applications a
    where a.spot_id = p_spot_id
      and a.artist_user_id = p_user_id
  );
$$;

revoke all on function public.is_studio_spot_applicant(uuid, uuid) from public;
grant execute on function public.is_studio_spot_applicant(uuid, uuid) to anon, authenticated;

drop policy if exists "Artists can view spots they applied to" on public.studio_spots;
create policy "Artists can view spots they applied to"
on public.studio_spots
for select
using (public.is_studio_spot_applicant(id, (select auth.uid())));
