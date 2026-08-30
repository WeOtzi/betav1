-- Endurece los helpers anti-recursión: no acepta user_id arbitrario y vive en
-- un esquema no expuesto por PostgREST.

create or replace function private.is_job_board_request_applicant(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.job_board_applications a
    where a.request_id = p_request_id
      and a.artist_id = (select auth.uid())
  );
$$;

create or replace function private.is_studio_spot_applicant(p_spot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.studio_spot_applications a
    where a.spot_id = p_spot_id
      and a.artist_user_id = (select auth.uid())
  );
$$;

grant usage on schema private to anon, authenticated;
revoke all on function private.is_job_board_request_applicant(uuid) from public;
revoke all on function private.is_studio_spot_applicant(uuid) from public;
grant execute on function private.is_job_board_request_applicant(uuid) to anon, authenticated;
grant execute on function private.is_studio_spot_applicant(uuid) to anon, authenticated;

drop policy if exists "Artists can view requests they applied to" on public.job_board_requests;
create policy "Artists can view requests they applied to"
on public.job_board_requests
for select
using (private.is_job_board_request_applicant(id));

drop policy if exists "Artists can view spots they applied to" on public.studio_spots;
create policy "Artists can view spots they applied to"
on public.studio_spots
for select
using (private.is_studio_spot_applicant(id));

drop function if exists public.is_job_board_request_applicant(uuid, uuid);
drop function if exists public.is_studio_spot_applicant(uuid, uuid);
