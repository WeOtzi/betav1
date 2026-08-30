-- The public Travel projection must honor the querying role's RLS. Anonymous
-- visitors only receive confirmed links for trips the artist explicitly chose
-- to share, and only the link columns required by the projection are granted.

begin;

drop policy if exists trip_studio_links_public_confirmed_select
  on public.trip_studio_links;
create policy trip_studio_links_public_confirmed_select
  on public.trip_studio_links for select to anon, authenticated
  using (
    status = 'confirmada'
    and exists (
      select 1
      from public.artist_trips t
      where t.id = trip_studio_links.trip_id
        and t.share_enabled = true
        and t.status in ('confirmado', 'finalizado')
        and t.cancelled_at is null
    )
  );

grant select (trip_id, studio_id, studio_name, studio_city, status)
  on table public.trip_studio_links to anon;

drop view if exists public.artist_public_travel_presences;
create view public.artist_public_travel_presences
with (security_barrier = true, security_invoker = true)
as
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

revoke all on table public.artist_public_travel_presences from public;
grant select on table public.artist_public_travel_presences
  to anon, authenticated, service_role;

comment on view public.artist_public_travel_presences is
  'RLS-invoker safe projection of artist-shared, studio-confirmed Travel presences.';

commit;
