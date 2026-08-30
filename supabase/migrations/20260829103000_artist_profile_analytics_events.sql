-- Structured artist analytics for Figma Estadisticas (122:12196).
-- Extends the existing privacy-scoped visit stream with explicit funnel
-- events and safe visitor snapshots. No email, phone, IP address or other
-- direct contact data is exposed to artists.

alter table public.artist_profile_visits
  add column if not exists event_kind text not null default 'profile_view',
  add column if not exists visitor_user_id uuid references auth.users (id) on delete set null,
  add column if not exists visitor_display_name text,
  add column if not exists visitor_type text,
  add column if not exists visitor_city text,
  add column if not exists visitor_interests text[] not null default '{}'::text[],
  add column if not exists artwork_key text,
  add column if not exists artwork_title text,
  add column if not exists requested_quote boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'artist_profile_visits_event_kind_check'
      and conrelid = 'public.artist_profile_visits'::regclass
  ) then
    alter table public.artist_profile_visits
      add constraint artist_profile_visits_event_kind_check
      check (event_kind in ('profile_view', 'portfolio_view', 'artwork_view'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'artist_profile_visits_visitor_type_check'
      and conrelid = 'public.artist_profile_visits'::regclass
  ) then
    alter table public.artist_profile_visits
      add constraint artist_profile_visits_visitor_type_check
      check (visitor_type is null or visitor_type in ('client', 'studio', 'artist'));
  end if;
end;
$$;

create index if not exists artist_profile_visits_artist_kind_created_idx
  on public.artist_profile_visits (artist_id, event_kind, created_at desc);

create index if not exists artist_profile_visits_artist_artwork_created_idx
  on public.artist_profile_visits (artist_id, artwork_key, created_at desc)
  where event_kind = 'artwork_view' and artwork_key is not null;

create index if not exists artist_profile_visits_artist_visitor_created_idx
  on public.artist_profile_visits (artist_id, visitor_user_id, created_at desc)
  where visitor_user_id is not null;

-- Some production environments contain the historical daily rollup as a
-- physical table. Preserve that data under a legacy name instead of dropping
-- it, then install the live RLS-aware view used by the application.
do $$
declare
  v_kind "char";
begin
  select c.relkind into v_kind
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'artist_profile_visits_daily';

  if v_kind = 'v' then
    execute 'drop view public.artist_profile_visits_daily';
  elsif v_kind = 'm' then
    if to_regclass('public.artist_profile_visits_daily_legacy') is null then
      execute 'alter materialized view public.artist_profile_visits_daily rename to artist_profile_visits_daily_legacy';
    else
      raise exception 'artist_profile_visits_daily legacy relation already exists';
    end if;
  elsif v_kind in ('r', 'p') then
    if to_regclass('public.artist_profile_visits_daily_legacy') is null then
      execute 'alter table public.artist_profile_visits_daily rename to artist_profile_visits_daily_legacy';
    else
      raise exception 'artist_profile_visits_daily legacy relation already exists';
    end if;
  elsif v_kind is not null then
    raise exception 'unsupported artist_profile_visits_daily relation kind: %', v_kind;
  end if;
end;
$$;

create view public.artist_profile_visits_daily
with (security_invoker = true)
as
select
  artist_id,
  artist_username,
  date_trunc('day', created_at)::date as day,
  event_kind,
  country,
  city,
  device_type,
  count(*)::integer as visits_count,
  count(distinct coalesce(visitor_user_id::text, nullif(ip_hash, ''), nullif(device_fingerprint, ''), id::text))::integer as unique_visitors
from public.artist_profile_visits
group by artist_id, artist_username, date_trunc('day', created_at)::date,
         event_kind, country, city, device_type;

create or replace view public.artist_artwork_view_counts
with (security_invoker = true)
as
select
  artist_id,
  artwork_key,
  max(artwork_title) as artwork_title,
  count(*)::integer as views_count,
  max(created_at) as last_viewed_at
from public.artist_profile_visits
where event_kind = 'artwork_view' and artwork_key is not null
group by artist_id, artwork_key;

revoke all on table public.artist_profile_visits from anon;
grant select on table public.artist_profile_visits to authenticated;
grant select on table public.artist_profile_visits_daily to authenticated;
grant select on table public.artist_artwork_view_counts to authenticated;
grant insert, select on table public.artist_profile_visits to service_role;
