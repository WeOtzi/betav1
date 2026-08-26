-- Rediseño Bauhaus 2026 · Travel del artista (/artist/travel)
-- Decisión de producto (25 ago 2026): hacer backend y cablearlo.
-- Modelo derivado de los frames Figma 68:11882…173:28256 (manifiesto
-- docs/plans/2026-08-25-rediseno-figma-mapeo.md). Solo DDL aditivo.
-- Nota: studio_id en trip_studio_links es referencia blanda al directorio de
-- estudios (sin FK) porque el vínculo puede apuntar a un estudio externo.

create table if not exists public.artist_trips (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  city text not null,
  country text not null,
  region text,
  start_date date not null,
  end_date date not null,
  trip_type text not null default 'guest_spot'
    check (trip_type in ('guest_spot', 'convencion', 'estudio_invitado')),
  status text not null default 'planificado'
    check (status in ('planificado', 'pendiente', 'confirmado', 'finalizado', 'cancelado')),
  origin text not null default 'manual' check (origin in ('manual', 'automatico')),
  studio_name_hint text,
  event_name text,
  agreed_conditions text,
  personal_notes text,
  share_slug text unique,
  share_enabled boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_trips_dates_check check (end_date >= start_date)
);

create index if not exists idx_artist_trips_artist
  on public.artist_trips (artist_user_id, start_date desc);
create index if not exists idx_artist_trips_share
  on public.artist_trips (share_slug) where share_enabled;

drop trigger if exists trg_artist_trips_updated_at on public.artist_trips;
create trigger trg_artist_trips_updated_at
  before update on public.artist_trips
  for each row execute function public.set_updated_at();

create table if not exists public.trip_studio_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.artist_trips (id) on delete cascade,
  studio_id uuid,
  studio_name text not null,
  studio_city text,
  status text not null default 'esperando_confirmacion'
    check (status in ('esperando_confirmacion', 'confirmada', 'rechazada', 'cancelada')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_trip_studio_links_trip on public.trip_studio_links (trip_id);

create table if not exists public.trip_checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.artist_trips (id) on delete cascade,
  label text not null,
  is_done boolean not null default false,
  is_custom boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_trip_checklist_trip on public.trip_checklist_items (trip_id, sort_order);

create table if not exists public.trip_documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.artist_trips (id) on delete cascade,
  category text not null default 'otro'
    check (category in ('pasaje', 'reserva_hotel', 'contrato', 'otro')),
  file_name text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_trip_documents_trip on public.trip_documents (trip_id);

create table if not exists public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.artist_trips (id) on delete cascade,
  event_type text not null
    check (event_type in ('creado', 'estudio_confirmado', 'pasajes_agregados', 'inicio', 'fin', 'cancelado', 'nota')),
  detail text,
  event_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists idx_trip_events_trip on public.trip_events (trip_id, event_date);

-- RLS: dueño total, soporte lectura; viajes compartidos legibles por cualquiera.
alter table public.artist_trips enable row level security;
alter table public.trip_studio_links enable row level security;
alter table public.trip_checklist_items enable row level security;
alter table public.trip_documents enable row level security;
alter table public.trip_events enable row level security;

drop policy if exists artist_trips_owner_all on public.artist_trips;
create policy artist_trips_owner_all on public.artist_trips
  for all using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);

drop policy if exists artist_trips_support_read on public.artist_trips;
create policy artist_trips_support_read on public.artist_trips
  for select using (public.is_support_user());

-- Página pública /travel/share?slug=… (itinerario compartido)
drop policy if exists artist_trips_public_shared on public.artist_trips;
create policy artist_trips_public_shared on public.artist_trips
  for select using (share_enabled = true and status <> 'cancelado');

drop policy if exists trip_studio_links_owner_all on public.trip_studio_links;
create policy trip_studio_links_owner_all on public.trip_studio_links
  for all using (exists (
    select 1 from public.artist_trips t
    where t.id = trip_studio_links.trip_id and t.artist_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.artist_trips t
    where t.id = trip_studio_links.trip_id and t.artist_user_id = (select auth.uid())
  ));

drop policy if exists trip_checklist_owner_all on public.trip_checklist_items;
create policy trip_checklist_owner_all on public.trip_checklist_items
  for all using (exists (
    select 1 from public.artist_trips t
    where t.id = trip_checklist_items.trip_id and t.artist_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.artist_trips t
    where t.id = trip_checklist_items.trip_id and t.artist_user_id = (select auth.uid())
  ));

drop policy if exists trip_documents_owner_all on public.trip_documents;
create policy trip_documents_owner_all on public.trip_documents
  for all using (exists (
    select 1 from public.artist_trips t
    where t.id = trip_documents.trip_id and t.artist_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.artist_trips t
    where t.id = trip_documents.trip_id and t.artist_user_id = (select auth.uid())
  ));

drop policy if exists trip_events_owner_all on public.trip_events;
create policy trip_events_owner_all on public.trip_events
  for all using (exists (
    select 1 from public.artist_trips t
    where t.id = trip_events.trip_id and t.artist_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.artist_trips t
    where t.id = trip_events.trip_id and t.artist_user_id = (select auth.uid())
  ));

-- Bucket privado para documentos de viaje; carpeta raíz = uid del artista.
insert into storage.buckets (id, name, public)
values ('artist-trip-docs', 'artist-trip-docs', false)
on conflict (id) do nothing;

drop policy if exists "artist_trip_docs_owner_all" on storage.objects;
create policy "artist_trip_docs_owner_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'artist-trip-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'artist-trip-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "artist_trip_docs_support_read" on storage.objects;
create policy "artist_trip_docs_support_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'artist-trip-docs' and public.is_support_user());
