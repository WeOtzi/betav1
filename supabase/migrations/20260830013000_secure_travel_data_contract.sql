-- Travel data contract hardening.
--
-- Public reads never touch artist_trips directly: exposed wrappers are tightly
-- granted SECURITY DEFINER functions that call ungranted helpers in the
-- non-exposed private schema. Every privileged function pins an empty
-- search_path and schema-qualifies all referenced objects.

begin;

-- Figma-backed summary/detail fields. Defaults keep existing rows compatible;
-- bounds reject corrupt counters, impossible temperatures and oversized
-- contact strings before they reach the UI.
alter table public.artist_trips
  add column if not exists interested_people_count integer default 0,
  add column if not exists climate_celsius numeric(4,1);

update public.artist_trips
set interested_people_count = 0
where interested_people_count is null;

alter table public.artist_trips
  alter column interested_people_count set default 0,
  alter column interested_people_count set not null,
  drop constraint if exists artist_trips_interested_people_count_check,
  add constraint artist_trips_interested_people_count_check
    check (interested_people_count between 0 and 1000000),
  drop constraint if exists artist_trips_climate_celsius_check,
  add constraint artist_trips_climate_celsius_check
    check (climate_celsius is null or climate_celsius between -90.0 and 60.0);

alter table public.trip_studio_links
  add column if not exists contact_name text,
  add column if not exists contact_details text,
  add column if not exists address_snapshot text,
  drop constraint if exists trip_studio_links_contact_name_check,
  add constraint trip_studio_links_contact_name_check
    check (
      contact_name is null
      or char_length(btrim(contact_name)) between 1 and 120
    ),
  drop constraint if exists trip_studio_links_contact_details_check,
  add constraint trip_studio_links_contact_details_check
    check (
      contact_details is null
      or char_length(btrim(contact_details)) between 1 and 500
    ),
  drop constraint if exists trip_studio_links_address_snapshot_check,
  add constraint trip_studio_links_address_snapshot_check
    check (
      address_snapshot is null
      or char_length(btrim(address_snapshot)) between 1 and 240
    );

-- Some older remote installations have the provenance columns but missed the
-- partial uniqueness index from the original hardening migration. Reassert it
-- here before any seed uses the source pair as an idempotent conflict target.
create unique index if not exists idx_trip_studio_links_source_once
  on public.trip_studio_links (source_type, source_id)
  where source_type is not null and source_id is not null;

-- Demo-owned detail rows need their own provenance so a rerun can replace the
-- visual fixture without deleting user-created checklist, document or timeline
-- rows that happen to belong to the same trip.
alter table public.trip_checklist_items
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  drop constraint if exists trip_checklist_items_source_type_check,
  add constraint trip_checklist_items_source_type_check
    check (source_type is null or source_type in (
      'manual', 'spot_application', 'studio_invitation', 'demo'
    )),
  drop constraint if exists trip_checklist_items_source_pair_check,
  add constraint trip_checklist_items_source_pair_check
    check ((source_type is null) = (source_id is null));

alter table public.trip_documents
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  drop constraint if exists trip_documents_source_type_check,
  add constraint trip_documents_source_type_check
    check (source_type is null or source_type in (
      'manual', 'spot_application', 'studio_invitation', 'demo'
    )),
  drop constraint if exists trip_documents_source_pair_check,
  add constraint trip_documents_source_pair_check
    check ((source_type is null) = (source_id is null));

alter table public.trip_events
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  drop constraint if exists trip_events_source_type_check,
  add constraint trip_events_source_type_check
    check (source_type is null or source_type in (
      'manual', 'spot_application', 'studio_invitation', 'demo'
    )),
  drop constraint if exists trip_events_source_pair_check,
  add constraint trip_events_source_pair_check
    check ((source_type is null) = (source_id is null));

create unique index if not exists uq_trip_checklist_items_source
  on public.trip_checklist_items (source_type, source_id)
  where source_type is not null and source_id is not null;
create unique index if not exists uq_trip_documents_source
  on public.trip_documents (source_type, source_id)
  where source_type is not null and source_id is not null;
create unique index if not exists uq_trip_events_source
  on public.trip_events (source_type, source_id)
  where source_type is not null and source_id is not null;

comment on column public.artist_trips.interested_people_count is
  'Non-negative number of people interested in booking during the trip.';
comment on column public.artist_trips.climate_celsius is
  'Optional destination temperature in Celsius, constrained to a physically plausible range.';
comment on column public.trip_studio_links.contact_name is
  'Private studio contact name visible only to the trip parties.';
comment on column public.trip_studio_links.contact_details is
  'Private studio contact channel visible only to the trip parties.';
comment on column public.trip_studio_links.address_snapshot is
  'Private immutable address snapshot captured for the trip; it does not change with the studio profile.';
comment on column public.trip_checklist_items.source_id is
  'Stable provenance UUID for scoped automatic/demo ownership; NULL for legacy/manual rows.';
comment on column public.trip_documents.source_id is
  'Stable provenance UUID for scoped automatic/demo ownership; NULL for legacy/manual rows.';
comment on column public.trip_events.source_id is
  'Stable provenance UUID for scoped automatic/demo ownership; NULL for legacy/manual rows.';

-- Passport stamps are historical aggregates, not derivations from the current
-- trip list. They are private to their owning artist and deliberately have no
-- anonymous/support policy.
create table if not exists public.artist_travel_passport_stamps (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references public.artists_db (user_id) on delete cascade,
  city text not null,
  country text not null,
  year smallint not null,
  tattoo_count integer not null default 0,
  studio_count integer not null default 0,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_travel_passport_city_check
    check (char_length(btrim(city)) between 1 and 120),
  constraint artist_travel_passport_country_check
    check (char_length(btrim(country)) between 1 and 120),
  constraint artist_travel_passport_year_check
    check (year between 1900 and 2200),
  constraint artist_travel_passport_tattoo_count_check
    check (tattoo_count between 0 and 1000000),
  constraint artist_travel_passport_studio_count_check
    check (studio_count between 0 and 1000000),
  constraint artist_travel_passport_source_pair_check
    check ((source_type is null) = (source_id is null))
);

create index if not exists idx_artist_travel_passport_owner_year
  on public.artist_travel_passport_stamps (artist_user_id, year desc, city);
create unique index if not exists uq_artist_travel_passport_source
  on public.artist_travel_passport_stamps (source_type, source_id)
  where source_type is not null and source_id is not null;

drop trigger if exists trg_artist_travel_passport_updated_at
  on public.artist_travel_passport_stamps;
create trigger trg_artist_travel_passport_updated_at
  before update on public.artist_travel_passport_stamps
  for each row execute function public.set_updated_at();

alter table public.artist_travel_passport_stamps enable row level security;

drop policy if exists artist_travel_passport_owner_all
  on public.artist_travel_passport_stamps;
create policy artist_travel_passport_owner_all
  on public.artist_travel_passport_stamps
  for all to authenticated
  using ((select auth.uid()) = artist_user_id)
  with check ((select auth.uid()) = artist_user_id);

revoke all privileges on table public.artist_travel_passport_stamps
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.artist_travel_passport_stamps to authenticated;

comment on table public.artist_travel_passport_stamps is
  'Owner-scoped historical Tattoo Passport aggregates; never part of the anonymous Travel share projection.';

-- Remove the legacy anonymous base-table path. Column grants on studio links
-- were added by 20260829161000 and must be revoked independently from table
-- grants in PostgreSQL.
drop policy if exists artist_trips_public_shared on public.artist_trips;
drop policy if exists trip_studio_links_public_confirmed_select
  on public.trip_studio_links;
revoke all privileges on table public.artist_trips from anon;
revoke all privileges on table public.trip_studio_links from anon;
revoke all privileges on table public.trip_checklist_items from anon;
revoke all privileges on table public.trip_documents from anon;
revoke all privileges on table public.trip_events from anon;
revoke select (trip_id, studio_id, studio_name, studio_city, status)
  on table public.trip_studio_links from anon;

create schema if not exists private;
revoke all on schema private from public;

-- One public itinerary by opaque slug. No notes, agreed conditions, storage
-- paths, internal user UUIDs, checklist rows or private studio contacts leave
-- this whitelist.
create or replace function private.get_public_travel_share(p_share_slug text)
returns table (
  id uuid,
  city text,
  country text,
  region text,
  start_date date,
  end_date date,
  trip_type text,
  status text,
  event_name text,
  share_slug text,
  interested_people_count integer,
  climate_celsius numeric,
  artist_name text,
  artist_username text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.city,
    t.country,
    t.region,
    t.start_date,
    t.end_date,
    t.trip_type,
    t.status,
    t.event_name,
    t.share_slug,
    t.interested_people_count,
    t.climate_celsius,
    a.name as artist_name,
    a.username as artist_username
  from public.artist_trips t
  join public.artists_db a on a.user_id = t.artist_user_id
  where p_share_slug is not null
    and char_length(btrim(p_share_slug)) between 1 and 160
    and lower(t.share_slug) = lower(btrim(p_share_slug))
    and t.share_enabled = true
    and t.status <> 'cancelado'
    and t.cancelled_at is null
  order by t.created_at desc
  limit 1;
$$;

create or replace function public.get_public_travel_share(p_share_slug text)
returns table (
  id uuid,
  city text,
  country text,
  region text,
  start_date date,
  end_date date,
  trip_type text,
  status text,
  event_name text,
  share_slug text,
  interested_people_count integer,
  climate_celsius numeric,
  artist_name text,
  artist_username text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.get_public_travel_share(p_share_slug);
$$;

revoke all on function private.get_public_travel_share(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_public_travel_share(text)
  from public, anon, authenticated;
grant execute on function public.get_public_travel_share(text)
  to anon, authenticated, service_role;

comment on function public.get_public_travel_share(text) is
  'Anonymous-safe Travel share projection. Returns one explicitly shared trip and no private notes, conditions, files or contacts.';

-- Keep the confirmed-link public-profile projection working without restoring
-- anonymous access to either base table. This remains a profile presence view,
-- not the full public itinerary endpoint.
create or replace function private.list_public_travel_presences()
returns table (
  trip_id uuid,
  artist_user_id uuid,
  city text,
  country text,
  region text,
  start_date date,
  end_date date,
  trip_type text,
  event_name text,
  studio_id uuid,
  studio_slug text,
  studio_name text,
  studio_city text,
  studio_country text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id as trip_id,
    t.artist_user_id,
    t.city,
    t.country,
    t.region,
    t.start_date,
    t.end_date,
    t.trip_type,
    t.event_name,
    l.studio_id,
    s.slug as studio_slug,
    s.name as studio_name,
    coalesce(l.studio_city, s.city, sl.city) as studio_city,
    coalesce(s.country, sl.country) as studio_country
  from public.artist_trips t
  join public.trip_studio_links l
    on l.trip_id = t.id and l.status = 'confirmada'
  join public.studios s
    on s.id = l.studio_id and s.is_active = true
  left join public.studio_locations sl on sl.id = s.primary_location_id
  where t.share_enabled = true
    and t.status in ('confirmado', 'finalizado')
    and t.cancelled_at is null;
$$;

revoke all on function private.list_public_travel_presences()
  from public, anon, authenticated, service_role;

create or replace function public.list_public_travel_presences()
returns table (
  trip_id uuid,
  artist_user_id uuid,
  city text,
  country text,
  region text,
  start_date date,
  end_date date,
  trip_type text,
  event_name text,
  studio_id uuid,
  studio_slug text,
  studio_name text,
  studio_city text,
  studio_country text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.list_public_travel_presences();
$$;

revoke all on function public.list_public_travel_presences()
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_travel_presences()
  to anon, authenticated, service_role;

create or replace view public.artist_public_travel_presences
with (security_barrier = true, security_invoker = true)
as
select
  p.trip_id,
  p.artist_user_id,
  p.city,
  p.country,
  p.region,
  p.start_date,
  p.end_date,
  p.trip_type,
  p.event_name,
  p.studio_id,
  p.studio_slug,
  p.studio_name,
  p.studio_city,
  p.studio_country
from public.list_public_travel_presences() p;

revoke all on table public.artist_public_travel_presences from public;
grant select on table public.artist_public_travel_presences
  to anon, authenticated, service_role;

comment on view public.artist_public_travel_presences is
  'Anonymous-safe artist profile projection of explicitly shared trips with confirmed active-studio links.';

-- Studio pending list. The caller must own the requested studio (or be active
-- support); the helper deliberately bypasses artist_trips RLS only after that
-- party check, fixing the PostgREST embed failure without a broader policy.
create or replace function private.list_pending_trip_studio_links(p_studio_id uuid)
returns table (
  id uuid,
  trip_id uuid,
  studio_id uuid,
  studio_name text,
  studio_city text,
  status text,
  requested_at timestamptz,
  contact_name text,
  contact_details text,
  address_snapshot text,
  artist_trip jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.is_support_user()
     and not exists (
       select 1
       from public.studios s
       where s.id = p_studio_id and s.user_id = v_actor
     ) then
    raise exception 'studio not found' using errcode = '42501';
  end if;

  return query
  select
    l.id,
    l.trip_id,
    l.studio_id,
    l.studio_name,
    l.studio_city,
    l.status,
    l.requested_at,
    l.contact_name,
    l.contact_details,
    l.address_snapshot,
    jsonb_build_object(
      'id', t.id,
      'artist_user_id', t.artist_user_id,
      'city', t.city,
      'country', t.country,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'trip_type', t.trip_type,
      'status', t.status
    ) as artist_trip
  from public.trip_studio_links l
  join public.artist_trips t on t.id = l.trip_id
  where l.studio_id = p_studio_id
    and l.status = 'esperando_confirmacion'
    and t.status <> 'cancelado'
    and t.cancelled_at is null
  order by l.requested_at asc, l.id asc;
end;
$$;

create or replace function public.list_pending_trip_studio_links(p_studio_id uuid)
returns table (
  id uuid,
  trip_id uuid,
  studio_id uuid,
  studio_name text,
  studio_city text,
  status text,
  requested_at timestamptz,
  contact_name text,
  contact_details text,
  address_snapshot text,
  artist_trip jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.list_pending_trip_studio_links(p_studio_id);
$$;

revoke all on function private.list_pending_trip_studio_links(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_pending_trip_studio_links(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pending_trip_studio_links(uuid)
  to authenticated;

-- Manual creation is one transaction: one owner-scoped trip, the canonical ten
-- checklist rows and its creation event. Callers cannot choose another owner.
create or replace function private.create_artist_trip(
  p_city text,
  p_country text,
  p_region text,
  p_start_date date,
  p_end_date date,
  p_trip_type text,
  p_studio_name_hint text default null,
  p_personal_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip public.artist_trips%rowtype;
begin
  if v_actor is null
     or not exists (
       select 1 from public.artists_db a where a.user_id = v_actor
     ) then
    raise exception 'artist authentication required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_city, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_country, ''))) not between 1 and 120 then
    raise exception 'city and country are required' using errcode = '22023';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'invalid trip dates' using errcode = '22023';
  end if;
  if p_trip_type not in ('guest_spot', 'convencion', 'estudio_invitado') then
    raise exception 'invalid trip type' using errcode = '22023';
  end if;
  if p_personal_notes is not null and char_length(p_personal_notes) > 5000 then
    raise exception 'personal notes are too long' using errcode = '22023';
  end if;

  insert into public.artist_trips (
    artist_user_id, city, country, region, start_date, end_date,
    trip_type, status, origin, studio_name_hint, personal_notes,
    source_type
  ) values (
    v_actor, btrim(p_city), btrim(p_country), nullif(btrim(p_region), ''),
    p_start_date, p_end_date, p_trip_type, 'planificado', 'manual',
    nullif(btrim(p_studio_name_hint), ''),
    nullif(btrim(p_personal_notes), ''),
    'manual'
  ) returning * into v_trip;

  insert into public.trip_checklist_items (
    trip_id, label, is_done, is_custom, sort_order
  )
  select v_trip.id, x.label, false, false, x.sort_order
  from (values
    ('Pasajes comprados', 0),
    ('Hospedaje reservado', 1),
    ('Estudio confirmado', 2),
    ('Contacté al estudio', 3),
    ('Agenda recibida', 4),
    ('Equipos preparados', 5),
    ('Materiales de trabajo listos', 6),
    ('Documentación preparada', 7),
    ('Seguro de viaje', 8),
    ('Equipaje listo', 9)
  ) as x(label, sort_order);

  insert into public.trip_events (trip_id, event_type, detail, event_date)
  values (v_trip.id, 'creado', 'Viaje creado', current_date);

  return to_jsonb(v_trip);
end;
$$;

create or replace function public.create_artist_trip(
  p_city text,
  p_country text,
  p_region text,
  p_start_date date,
  p_end_date date,
  p_trip_type text,
  p_studio_name_hint text default null,
  p_personal_notes text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_artist_trip(
    p_city,
    p_country,
    p_region,
    p_start_date,
    p_end_date,
    p_trip_type,
    p_studio_name_hint,
    p_personal_notes
  );
$$;

revoke all on function private.create_artist_trip(text, text, text, date, date, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_artist_trip(text, text, text, date, date, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_artist_trip(text, text, text, date, date, text, text, text)
  to authenticated;

create or replace function private.update_artist_trip_dates(
  p_trip_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip public.artist_trips%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'invalid trip dates' using errcode = '22023';
  end if;

  select * into v_trip
  from public.artist_trips t
  where t.id = p_trip_id
  for update;

  if not found
     or (v_trip.artist_user_id is distinct from v_actor and not public.is_support_user()) then
    raise exception 'trip not found' using errcode = '42501';
  end if;
  if v_trip.status = 'cancelado' or v_trip.cancelled_at is not null then
    raise exception 'cancelled trips cannot change dates' using errcode = '23514';
  end if;

  if v_trip.start_date is distinct from p_start_date
     or v_trip.end_date is distinct from p_end_date then
    update public.artist_trips t
    set start_date = p_start_date,
        end_date = p_end_date
    where t.id = p_trip_id
    returning * into v_trip;

    insert into public.trip_events (trip_id, event_type, detail, event_date)
    values (
      p_trip_id,
      'nota',
      'Fechas actualizadas · ' || p_start_date::text || ' – ' || p_end_date::text,
      current_date
    );
  end if;

  return to_jsonb(v_trip);
end;
$$;

create or replace function public.update_artist_trip_dates(
  p_trip_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.update_artist_trip_dates(p_trip_id, p_start_date, p_end_date);
$$;

revoke all on function private.update_artist_trip_dates(uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.update_artist_trip_dates(uuid, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.update_artist_trip_dates(uuid, date, date)
  to authenticated;

-- Cancellation and reactivation are transaction-scoped RPCs. Cancellation
-- closes every pending studio request before changing the trip state. Locking
-- the trip first establishes the same lock order used by resolution below.
create or replace function private.cancel_artist_trip(
  p_trip_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip public.artist_trips%rowtype;
  v_cancelled_links integer := 0;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'cancellation reason is too long' using errcode = '22023';
  end if;

  select * into v_trip
  from public.artist_trips t
  where t.id = p_trip_id
  for update;

  if not found
     or (v_trip.artist_user_id is distinct from v_actor and not public.is_support_user()) then
    raise exception 'trip not found' using errcode = '42501';
  end if;

  if v_trip.status <> 'cancelado' or v_trip.cancelled_at is null then
    update public.trip_studio_links l
    set status = 'cancelada',
        resolved_at = now(),
        resolved_by_user_id = v_actor
    where l.trip_id = p_trip_id
      and l.status = 'esperando_confirmacion';
    get diagnostics v_cancelled_links = row_count;

    update public.artist_trips t
    set status = 'cancelado',
        cancelled_at = coalesce(t.cancelled_at, now()),
        share_enabled = false
    where t.id = p_trip_id
    returning * into v_trip;

    insert into public.trip_events (trip_id, event_type, detail, event_date)
    select
      p_trip_id,
      'cancelado',
      nullif(btrim(p_reason), ''),
      current_date
    where not exists (
      select 1
      from public.trip_events e
      where e.trip_id = p_trip_id
        and e.event_type = 'cancelado'
        and e.event_date = current_date
        and e.detail is not distinct from nullif(btrim(p_reason), '')
    );
  end if;

  return jsonb_build_object(
    'trip_id', v_trip.id,
    'status', v_trip.status,
    'cancelled_at', v_trip.cancelled_at,
    'cancelled_links', v_cancelled_links
  );
end;
$$;

create or replace function public.cancel_artist_trip(
  p_trip_id uuid,
  p_reason text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.cancel_artist_trip(p_trip_id, p_reason);
$$;

create or replace function private.reactivate_artist_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip public.artist_trips%rowtype;
  v_status text;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_trip
  from public.artist_trips t
  where t.id = p_trip_id
  for update;

  if not found
     or (v_trip.artist_user_id is distinct from v_actor and not public.is_support_user()) then
    raise exception 'trip not found' using errcode = '42501';
  end if;

  if v_trip.status = 'cancelado' or v_trip.cancelled_at is not null then
    v_status := case
      when v_trip.end_date < current_date then 'finalizado'
      when exists (
        select 1 from public.trip_studio_links l
        where l.trip_id = p_trip_id and l.status = 'confirmada'
      ) then 'confirmado'
      else 'planificado'
    end;

    update public.artist_trips t
    set status = v_status,
        cancelled_at = null
    where t.id = p_trip_id
    returning * into v_trip;

    insert into public.trip_events (trip_id, event_type, detail, event_date)
    select p_trip_id, 'nota', 'Viaje reactivado', current_date
    where not exists (
      select 1
      from public.trip_events e
      where e.trip_id = p_trip_id
        and e.event_type = 'nota'
        and e.detail = 'Viaje reactivado'
        and e.event_date = current_date
    );
  end if;

  return jsonb_build_object(
    'trip_id', v_trip.id,
    'status', v_trip.status,
    'cancelled_at', v_trip.cancelled_at
  );
end;
$$;

create or replace function public.reactivate_artist_trip(p_trip_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.reactivate_artist_trip(p_trip_id);
$$;

revoke all on function private.cancel_artist_trip(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.reactivate_artist_trip(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_artist_trip(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reactivate_artist_trip(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_artist_trip(uuid, text) to authenticated;
grant execute on function public.reactivate_artist_trip(uuid) to authenticated;

-- Enforce the parent-state invariant even if a future privileged caller writes
-- a link directly instead of using resolve_trip_studio_link.
create or replace function private.guard_trip_studio_link_parent_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmada'
     and new.status is distinct from old.status
     and exists (
       select 1
       from public.artist_trips t
       where t.id = new.trip_id
         and (t.status = 'cancelado' or t.cancelled_at is not null)
     ) then
    raise exception 'cancelled trips cannot confirm studio links' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_trip_studio_link_parent_active
  on public.trip_studio_links;
create trigger trg_guard_trip_studio_link_parent_active
  before update on public.trip_studio_links
  for each row execute function private.guard_trip_studio_link_parent_active();

revoke all on function private.guard_trip_studio_link_parent_active()
  from public, anon, authenticated, service_role;

-- Resolution now locks parent then child, and rejects cancelled parents before
-- deciding the pending request. Its narrowly granted public wrapper delegates
-- to an ungranted private helper after verifying the studio party.
create or replace function private.resolve_trip_studio_link(
  p_link_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip_id uuid;
  v_link public.trip_studio_links%rowtype;
  v_trip public.artist_trips%rowtype;
  v_studio_owner_id uuid;
  v_new_status text;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('confirm', 'reject') then
    raise exception 'invalid action' using errcode = '22023';
  end if;

  select l.trip_id into v_trip_id
  from public.trip_studio_links l
  where l.id = p_link_id;
  if not found then
    raise exception 'studio link not found' using errcode = 'P0002';
  end if;

  select * into v_trip
  from public.artist_trips t
  where t.id = v_trip_id
  for update;
  if not found then
    raise exception 'studio link not found' using errcode = 'P0002';
  end if;

  select * into v_link
  from public.trip_studio_links l
  where l.id = p_link_id and l.trip_id = v_trip_id
  for update;
  if not found then
    raise exception 'studio link not found' using errcode = 'P0002';
  end if;

  select s.user_id into v_studio_owner_id
  from public.studios s
  where s.id = v_link.studio_id;

  if v_actor is distinct from v_studio_owner_id and not public.is_support_user() then
    raise exception 'studio link not found' using errcode = '42501';
  end if;
  if v_trip.status = 'cancelado' or v_trip.cancelled_at is not null then
    raise exception 'cancelled trips cannot resolve studio links' using errcode = '23514';
  end if;
  if v_link.status <> 'esperando_confirmacion' then
    raise exception 'studio link is already resolved' using errcode = '23514';
  end if;

  v_new_status := case when p_action = 'confirm' then 'confirmada' else 'rechazada' end;
  update public.trip_studio_links l
  set status = v_new_status,
      resolved_at = now(),
      resolved_by_user_id = v_actor
  where l.id = p_link_id
  returning * into v_link;

  if v_new_status = 'confirmada' then
    update public.artist_trips t
    set status = 'confirmado'
    where t.id = v_trip_id;

    insert into public.trip_events (trip_id, event_type, detail, event_date)
    values (v_trip_id, 'estudio_confirmado', v_link.studio_name, current_date);

    update public.trip_checklist_items i
    set is_done = true
    where i.trip_id = v_trip_id
      and lower(i.label) in ('estudio confirmado', 'confirmar estudio');
  else
    update public.artist_trips t
    set status = case
      when exists (
        select 1 from public.trip_studio_links x
        where x.trip_id = t.id and x.status = 'confirmada'
      ) then 'confirmado'
      when exists (
        select 1 from public.trip_studio_links x
        where x.trip_id = t.id and x.status = 'esperando_confirmacion'
      ) then 'pendiente'
      else 'planificado'
    end
    where t.id = v_trip_id;
  end if;

  return jsonb_build_object(
    'link_id', v_link.id,
    'trip_id', v_link.trip_id,
    'status', v_new_status,
    'resolved_at', v_link.resolved_at
  );
end;
$$;

create or replace function public.resolve_trip_studio_link(
  p_link_id uuid,
  p_action text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_trip_studio_link(p_link_id, p_action);
$$;

revoke all on function private.resolve_trip_studio_link(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_trip_studio_link(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_trip_studio_link(uuid, text)
  to authenticated;

-- Accepted invitations use one idempotent initializer regardless of insertion
-- order. Both the membership transition and the later detail row call it, so a
-- membership inserted active before its detail can no longer lose its trip.
create or replace function private.initialize_trip_from_accepted_invitation(
  p_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
  v_studio public.studios%rowtype;
  v_city text;
  v_country text;
  v_trip_id uuid;
  v_end date;
begin
  select * into v_membership
  from public.studio_artist_memberships m
  where m.id = p_membership_id;
  if not found or v_membership.status <> 'active' then
    return;
  end if;

  select * into v_detail
  from public.studio_membership_invitation_details d
  where d.membership_id = v_membership.id;
  if not found or v_detail.proposed_start_date is null then
    return;
  end if;

  select * into v_studio
  from public.studios s
  where s.id = v_membership.studio_id;
  if not found then
    return;
  end if;

  select coalesce(sl.city, v_studio.city), coalesce(sl.country, v_studio.country)
    into v_city, v_country
  from (select 1) seed
  left join public.studio_locations sl on sl.id = v_membership.location_id;

  v_end := coalesce(v_detail.proposed_end_date, v_detail.proposed_start_date + 6);

  insert into public.artist_trips (
    artist_user_id, city, country, start_date, end_date, trip_type,
    status, origin, studio_name_hint, agreed_conditions,
    source_type, source_id
  ) values (
    v_membership.artist_user_id,
    coalesce(v_city, 'Por confirmar'),
    coalesce(v_country, 'Por confirmar'),
    v_detail.proposed_start_date,
    v_end,
    case when v_membership.role = 'guest' then 'guest_spot' else 'estudio_invitado' end,
    'confirmado',
    'automatico',
    v_studio.name,
    case when v_membership.revenue_split_pct is null then v_detail.message
      else 'Split ' || trim(to_char(v_membership.revenue_split_pct, 'FM999990D00')) || '% para el artista.' end,
    'studio_invitation',
    v_membership.id
  ) on conflict do nothing;

  select t.id into v_trip_id
  from public.artist_trips t
  where t.source_type = 'studio_invitation'
    and t.source_id = v_membership.id;
  if v_trip_id is null then
    return;
  end if;

  insert into public.trip_studio_links (
    trip_id, studio_id, studio_name, studio_city, status,
    requested_by_user_id, resolved_by_user_id, resolved_at,
    source_type, source_id
  ) values (
    v_trip_id,
    v_studio.id,
    v_studio.name,
    v_city,
    'confirmada',
    v_membership.artist_user_id,
    coalesce(v_membership.invited_by_user_id, v_studio.user_id),
    now(),
    'studio_invitation',
    v_membership.id
  ) on conflict do nothing;

  insert into public.trip_checklist_items (
    trip_id, label, is_done, is_custom, sort_order
  )
  select v_trip_id, x.label, x.is_done, false, x.sort_order
  from (values
    ('Pasajes comprados', false, 0),
    ('Hospedaje reservado', false, 1),
    ('Estudio confirmado', true, 2),
    ('Contacté al estudio', true, 3),
    ('Agenda recibida', false, 4),
    ('Equipos preparados', false, 5),
    ('Materiales de trabajo listos', false, 6),
    ('Documentación preparada', false, 7),
    ('Seguro de viaje', false, 8),
    ('Equipaje listo', false, 9)
  ) as x(label, is_done, sort_order)
  where not exists (
    select 1 from public.trip_checklist_items i
    where i.trip_id = v_trip_id and i.label = x.label
  );

  insert into public.trip_events (trip_id, event_type, detail, event_date)
  select v_trip_id, x.event_type, x.detail, current_date
  from (values
    ('creado', 'Viaje creado desde una invitación aceptada'),
    ('estudio_confirmado', v_studio.name)
  ) as x(event_type, detail)
  where not exists (
    select 1 from public.trip_events e
    where e.trip_id = v_trip_id and e.event_type = x.event_type
  );
end;
$$;

revoke all on function private.initialize_trip_from_accepted_invitation(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_trip_from_accepted_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.initialize_trip_from_accepted_invitation(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.create_trip_from_invitation_detail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.initialize_trip_from_accepted_invitation(new.membership_id);
  return new;
end;
$$;

drop trigger if exists trg_create_trip_from_accepted_invitation
  on public.studio_artist_memberships;
create trigger trg_create_trip_from_accepted_invitation
  after insert or update on public.studio_artist_memberships
  for each row execute function public.create_trip_from_accepted_invitation();

drop trigger if exists trg_create_trip_from_invitation_detail
  on public.studio_membership_invitation_details;
create trigger trg_create_trip_from_invitation_detail
  after insert or update on public.studio_membership_invitation_details
  for each row execute function public.create_trip_from_invitation_detail();

-- Repair both missing trips caused by membership-before-detail insertion and
-- incomplete graphs from the earlier one-sided trigger.
do $$
declare
  r record;
begin
  for r in
    select m.id
    from public.studio_artist_memberships m
    join public.studio_membership_invitation_details d
      on d.membership_id = m.id
    where m.status = 'active'
      and d.proposed_start_date is not null
  loop
    perform private.initialize_trip_from_accepted_invitation(r.id);
  end loop;
end;
$$;

revoke all on function public.create_trip_from_accepted_invitation()
  from public, anon, authenticated, service_role;
revoke all on function public.create_trip_from_invitation_detail()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
