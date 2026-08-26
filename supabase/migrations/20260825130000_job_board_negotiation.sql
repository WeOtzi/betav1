-- Rediseño Bauhaus 2026 · Negociación del Job Board + contador de vistas
-- Los frames de /client/requests y /artist/applications (Figma 307:17015,
-- 133:16259) muestran contraofertas entre cliente y artista sobre una
-- postulación; no existía backend. El statstrip de la publicación necesita
-- visualizaciones reales: van en la tabla satélite job_board_request_stats
-- (se decidió no alterar job_board_requests). Solo cambios aditivos.
-- Aplicada al proyecto vivo el 25 ago 2026 en dos partes.

create table if not exists public.job_board_counter_offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.job_board_applications (id) on delete cascade,
  author_role text not null check (author_role in ('client', 'artist')),
  price numeric,
  currency varchar default 'USD',
  proposed_date text,
  note text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'aceptada', 'rechazada', 'reemplazada')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists idx_jb_counter_offers_application
  on public.job_board_counter_offers (application_id, created_at desc);

alter table public.job_board_counter_offers enable row level security;

drop policy if exists jb_counter_offers_parties_select on public.job_board_counter_offers;
create policy jb_counter_offers_parties_select on public.job_board_counter_offers
  for select using (
    exists (
      select 1 from public.job_board_applications a
      where a.id = job_board_counter_offers.application_id
        and a.artist_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.job_board_applications a
      join public.job_board_requests r on r.id = a.request_id
      where a.id = job_board_counter_offers.application_id
        and r.client_user_id = (select auth.uid())
    )
    or public.is_support_user()
  );

drop policy if exists jb_counter_offers_parties_insert on public.job_board_counter_offers;
create policy jb_counter_offers_parties_insert on public.job_board_counter_offers
  for insert with check (
    (author_role = 'artist' and exists (
      select 1 from public.job_board_applications a
      where a.id = job_board_counter_offers.application_id
        and a.artist_id = (select auth.uid())
    ))
    or (author_role = 'client' and exists (
      select 1
      from public.job_board_applications a
      join public.job_board_requests r on r.id = a.request_id
      where a.id = job_board_counter_offers.application_id
        and r.client_user_id = (select auth.uid())
    ))
  );

drop policy if exists jb_counter_offers_parties_update on public.job_board_counter_offers;
create policy jb_counter_offers_parties_update on public.job_board_counter_offers
  for update using (
    exists (
      select 1 from public.job_board_applications a
      where a.id = job_board_counter_offers.application_id
        and a.artist_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.job_board_applications a
      join public.job_board_requests r on r.id = a.request_id
      where a.id = job_board_counter_offers.application_id
        and r.client_user_id = (select auth.uid())
    )
  );

-- Contador de visualizaciones (tabla satélite; escritura solo vía RPC definer).
create table if not exists public.job_board_request_stats (
  request_id uuid primary key references public.job_board_requests (id) on delete cascade,
  view_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.job_board_request_stats enable row level security;

drop policy if exists jb_request_stats_read on public.job_board_request_stats;
create policy jb_request_stats_read on public.job_board_request_stats
  for select using (
    exists (
      select 1 from public.job_board_requests r
      where r.id = job_board_request_stats.request_id
        and (
          (r.status = 'open' and r.is_public = true)
          or r.client_user_id = (select auth.uid())
        )
    )
    or public.is_support_user()
  );

create or replace function public.increment_job_request_views(p_request_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.job_board_request_stats (request_id, view_count, updated_at)
  select r.id, 1, now()
  from public.job_board_requests r
  where r.id = p_request_id and r.status = 'open' and r.is_public = true
  on conflict (request_id)
  do update set view_count = job_board_request_stats.view_count + 1, updated_at = now();
$$;

revoke all on function public.increment_job_request_views(uuid) from public;
grant execute on function public.increment_job_request_views(uuid) to anon, authenticated;
