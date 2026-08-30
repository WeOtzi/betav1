-- Persistent sponsored Job Board opportunities and per-artist saved requests.

alter table public.job_board_applications
  add column if not exists estimated_duration text;

alter table public.job_board_requests
  add column if not exists is_featured boolean not null default false,
  add column if not exists featured_rank smallint,
  add column if not exists display_title text,
  add column if not exists client_display_name text,
  add column if not exists client_avatar_url text,
  add column if not exists sponsor_name text,
  add column if not exists sponsor_description text,
  add column if not exists featured_tags text[] not null default array[]::text[],
  add column if not exists featured_image_url text,
  add column if not exists featured_slots_count smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_board_applications'::regclass
      and conname = 'job_board_applications_estimated_duration_check'
  ) then
    alter table public.job_board_applications
      add constraint job_board_applications_estimated_duration_check
      check (
        estimated_duration is null
        or estimated_duration in ('1_day', '2_3_days', '1_week', '2_weeks', 'custom')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_board_requests'::regclass
      and conname = 'job_board_requests_featured_rank_positive'
  ) then
    alter table public.job_board_requests
      add constraint job_board_requests_featured_rank_positive
      check (featured_rank is null or featured_rank > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_board_requests'::regclass
      and conname = 'job_board_requests_featured_slots_positive'
  ) then
    alter table public.job_board_requests
      add constraint job_board_requests_featured_slots_positive
      check (featured_slots_count is null or featured_slots_count > 0);
  end if;
end
$$;

create unique index if not exists idx_job_board_open_featured_rank
  on public.job_board_requests (featured_rank)
  where status = 'open' and is_public = true and is_featured = true
    and featured_rank is not null;

create table if not exists public.artist_saved_job_requests (
  artist_user_id uuid not null
    references public.artists_db(user_id) on delete cascade,
  request_id uuid not null
    references public.job_board_requests(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (artist_user_id, request_id)
);

create index if not exists idx_artist_saved_job_requests_request
  on public.artist_saved_job_requests (request_id);

alter table public.artist_saved_job_requests enable row level security;

create policy artist_saved_job_requests_owner_select
on public.artist_saved_job_requests
for select
using (artist_user_id = (select auth.uid()));

create policy artist_saved_job_requests_owner_insert
on public.artist_saved_job_requests
for insert
with check (
  artist_user_id = (select auth.uid())
  and exists (
    select 1 from public.job_board_requests r
    where r.id = request_id and r.status = 'open' and r.is_public = true
  )
);

create policy artist_saved_job_requests_owner_delete
on public.artist_saved_job_requests
for delete
using (artist_user_id = (select auth.uid()));

revoke all on public.artist_saved_job_requests from anon;
grant select, insert, delete on public.artist_saved_job_requests to authenticated;

comment on column public.job_board_requests.is_featured is
  'Oportunidad patrocinada/destacada del Job Board.';
comment on column public.job_board_requests.featured_rank is
  'Orden editorial de oportunidades destacadas.';
comment on column public.job_board_requests.display_title is
  'Título público corto de la solicitud; evita derivarlo de la descripción completa.';
comment on column public.job_board_requests.client_display_name is
  'Nombre público desnormalizado que el cliente eligió mostrar en esta solicitud.';
comment on table public.artist_saved_job_requests is
  'Solicitudes del Job Board guardadas por cada artista.';
