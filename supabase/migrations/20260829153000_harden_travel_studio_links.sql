-- Travel: studio-owned confirmation, auditable state transitions and automatic
-- trips sourced from accepted Spots / studio invitations.
-- Figma: 68:11882, 419:2487, 131:14426, 132:14729,
-- 173:24897, 173:25982, 173:26741, 173:27503, 173:28256.

begin;

alter table public.artist_trips
  add column if not exists source_type text,
  add column if not exists source_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.artist_trips'::regclass
      and conname = 'artist_trips_source_type_check'
  ) then
    alter table public.artist_trips
      add constraint artist_trips_source_type_check
      check (source_type is null or source_type in (
        'manual', 'spot_application', 'studio_invitation', 'demo'
      ));
  end if;
end;
$$;

create unique index if not exists idx_artist_trips_source_once
  on public.artist_trips (source_type, source_id)
  where source_type is not null and source_id is not null;

alter table public.trip_studio_links
  add column if not exists requested_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists resolved_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_studio_links'::regclass
      and conname = 'trip_studio_links_source_type_check'
  ) then
    alter table public.trip_studio_links
      add constraint trip_studio_links_source_type_check
      check (source_type is null or source_type in (
        'manual', 'spot_application', 'studio_invitation', 'demo'
      ));
  end if;
end;
$$;

update public.trip_studio_links l
set requested_by_user_id = t.artist_user_id
from public.artist_trips t
where t.id = l.trip_id and l.requested_by_user_id is null;

create index if not exists idx_trip_studio_links_studio_status
  on public.trip_studio_links (studio_id, status, requested_at desc)
  where studio_id is not null;

create unique index if not exists idx_trip_studio_links_source_once
  on public.trip_studio_links (source_type, source_id)
  where source_type is not null and source_id is not null;

create table if not exists public.trip_studio_link_audit (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.trip_studio_links(id) on delete cascade,
  trip_id uuid not null references public.artist_trips(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text not null,
  source text not null default 'ui'
    check (source in ('ui', 'spot_application', 'studio_invitation', 'support', 'seed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_trip_studio_link_audit_link
  on public.trip_studio_link_audit (link_id, created_at desc);

alter table public.trip_studio_link_audit enable row level security;

drop policy if exists trip_studio_link_audit_parties_read on public.trip_studio_link_audit;
create policy trip_studio_link_audit_parties_read
  on public.trip_studio_link_audit for select to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1
      from public.trip_studio_links l
      join public.artist_trips t on t.id = l.trip_id
      left join public.studios s on s.id = l.studio_id
      where l.id = trip_studio_link_audit.link_id
        and (t.artist_user_id = (select auth.uid()) or s.user_id = (select auth.uid()))
    )
  );

revoke all on table public.trip_studio_link_audit from anon, authenticated;
grant select on table public.trip_studio_link_audit to authenticated;
grant select, insert, update, delete on table public.trip_studio_link_audit to service_role;

create or replace function public.guard_trip_studio_link_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artist_user_id uuid;
  v_studio_owner_id uuid;
  v_studio_name text;
  v_studio_city text;
  v_actor uuid := auth.uid();
  v_privileged boolean := coalesce(auth.role(), '') = 'service_role'
    or (
      auth.role() is null
      and session_user in ('postgres', 'service_role', 'supabase_admin')
    );
  v_authoritative_source boolean := false;
begin
  select t.artist_user_id into v_artist_user_id
  from public.artist_trips t
  where t.id = new.trip_id;

  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  if new.studio_id is not null then
    select s.user_id, s.name, coalesce(s.city, sl.city)
      into v_studio_owner_id, v_studio_name, v_studio_city
    from public.studios s
    left join public.studio_locations sl on sl.id = s.primary_location_id
    where s.id = new.studio_id;

    if not found and not v_privileged then
      raise exception 'studio not found' using errcode = 'P0002';
    end if;

    new.studio_name := coalesce(v_studio_name, new.studio_name);
    new.studio_city := coalesce(v_studio_city, new.studio_city);
  end if;

  if new.source_type = 'spot_application' and new.source_id is not null then
    select exists (
      select 1
      from public.studio_spot_applications a
      join public.studio_spots sp on sp.id = a.spot_id
      where a.id = new.source_id
        and a.artist_user_id = v_artist_user_id
        and sp.studio_id = new.studio_id
        and a.status = 'accepted'
    ) into v_authoritative_source;
  elsif new.source_type = 'studio_invitation' and new.source_id is not null then
    select exists (
      select 1
      from public.studio_artist_memberships m
      where m.id = new.source_id
        and m.artist_user_id = v_artist_user_id
        and m.studio_id = new.studio_id
        and m.status = 'active'
    ) into v_authoritative_source;
  end if;

  if tg_op = 'INSERT' then
    new.requested_by_user_id := coalesce(new.requested_by_user_id, v_actor, v_artist_user_id);
    new.updated_at := now();

    if v_privileged then
      return new;
    end if;

    if new.studio_id is null then
      raise exception 'a We Otzi studio is required' using errcode = '23514';
    end if;

    if new.status = 'esperando_confirmacion' then
      if v_actor is null or (v_actor <> v_artist_user_id and not public.is_support_user()) then
        raise exception 'only the trip owner can request a studio link' using errcode = '42501';
      end if;
    elsif new.status = 'confirmada' and v_authoritative_source then
      new.resolved_at := coalesce(new.resolved_at, now());
      new.resolved_by_user_id := coalesce(new.resolved_by_user_id, v_actor, v_studio_owner_id);
    else
      raise exception 'new studio links must await studio confirmation' using errcode = '42501';
    end if;

    return new;
  end if;

  new.updated_at := now();

  if v_privileged then
    return new;
  end if;

  if new.trip_id is distinct from old.trip_id
     or new.studio_id is distinct from old.studio_id
     or new.requested_by_user_id is distinct from old.requested_by_user_id
     or new.source_type is distinct from old.source_type
     or new.source_id is distinct from old.source_id then
    raise exception 'studio link identity is immutable' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'esperando_confirmacion' then
      raise exception 'resolved studio links cannot be decided again' using errcode = '23514';
    end if;

    if new.status in ('confirmada', 'rechazada') then
      if v_actor is null
         or (v_actor is distinct from v_studio_owner_id and not public.is_support_user()) then
        raise exception 'only the studio owner or support can resolve this link' using errcode = '42501';
      end if;
      new.resolved_at := now();
      new.resolved_by_user_id := v_actor;
    elsif new.status = 'cancelada' then
      if v_actor is null
         or (v_actor <> v_artist_user_id and not public.is_support_user()) then
        raise exception 'only the artist or support can cancel this request' using errcode = '42501';
      end if;
      new.resolved_at := now();
      new.resolved_by_user_id := v_actor;
    else
      raise exception 'invalid studio link transition' using errcode = '23514';
    end if;
  elsif new.resolved_at is distinct from old.resolved_at
     or new.resolved_by_user_id is distinct from old.resolved_by_user_id then
    raise exception 'resolution metadata is server managed' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_trip_studio_link_transition on public.trip_studio_links;
create trigger trg_guard_trip_studio_link_transition
  before insert or update on public.trip_studio_links
  for each row execute function public.guard_trip_studio_link_transition();

create or replace function public.audit_trip_studio_link_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := case
    when new.source_type = 'spot_application' then 'spot_application'
    when new.source_type = 'studio_invitation' then 'studio_invitation'
    when public.is_support_user() then 'support'
    when coalesce(auth.role(), '') = 'service_role' then 'seed'
    when auth.role() is null
      and session_user in ('postgres', 'service_role', 'supabase_admin') then 'seed'
    else 'ui'
  end;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.trip_studio_link_audit (
      link_id, trip_id, actor_user_id, old_status, new_status, source
    ) values (
      new.id, new.trip_id, auth.uid(),
      case when tg_op = 'UPDATE' then old.status else null end,
      new.status, v_source
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_trip_studio_link_transition on public.trip_studio_links;
create trigger trg_audit_trip_studio_link_transition
  after insert or update on public.trip_studio_links
  for each row execute function public.audit_trip_studio_link_transition();

create or replace function public.guard_artist_trip_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or (
       auth.role() is null
       and session_user in ('postgres', 'service_role', 'supabase_admin')
     )
     or public.is_support_user() then
    return new;
  end if;

  if new.artist_user_id is distinct from old.artist_user_id
     or new.source_type is distinct from old.source_type
     or new.source_id is distinct from old.source_id then
    raise exception 'trip ownership and source are immutable' using errcode = '42501';
  end if;

  if new.status = 'confirmado' and old.status is distinct from new.status
     and not exists (
       select 1 from public.trip_studio_links l
       where l.trip_id = new.id and l.status = 'confirmada'
     ) then
    raise exception 'a studio-confirmed link is required' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_artist_trip_confirmation on public.artist_trips;
create trigger trg_guard_artist_trip_confirmation
  before update on public.artist_trips
  for each row execute function public.guard_artist_trip_confirmation();

drop policy if exists trip_studio_links_owner_all on public.trip_studio_links;
drop policy if exists trip_studio_links_parties_select on public.trip_studio_links;
create policy trip_studio_links_parties_select
  on public.trip_studio_links for select to authenticated
  using (
    public.is_support_user()
    or exists (
      select 1
      from public.artist_trips t
      left join public.studios s on s.id = trip_studio_links.studio_id
      where t.id = trip_studio_links.trip_id
        and (t.artist_user_id = (select auth.uid()) or s.user_id = (select auth.uid()))
    )
  );

-- State changes use guarded RPCs. Removing direct writes also keeps future UI
-- clients from accidentally re-introducing artist self-confirmation.
revoke all on table public.trip_studio_links from anon;
revoke insert, update, delete on table public.trip_studio_links from authenticated;
grant select on table public.trip_studio_links to authenticated;
grant select, insert, update, delete on table public.trip_studio_links to service_role;

create or replace function public.request_trip_studio_link(
  p_trip_id uuid,
  p_studio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.artist_trips%rowtype;
  v_studio public.studios%rowtype;
  v_link public.trip_studio_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_trip from public.artist_trips
  where id = p_trip_id and artist_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'trip not found' using errcode = '42501';
  end if;

  if v_trip.status in ('cancelado', 'finalizado') then
    raise exception 'trip does not accept new studio links' using errcode = '23514';
  end if;

  select * into v_studio from public.studios
  where id = p_studio_id and is_active = true;
  if not found or v_studio.user_id is null then
    raise exception 'studio is not available for confirmation' using errcode = '23514';
  end if;

  select * into v_link
  from public.trip_studio_links
  where trip_id = p_trip_id
    and studio_id = p_studio_id
    and status in ('esperando_confirmacion', 'confirmada')
  order by requested_at desc
  limit 1;

  if found then
    return to_jsonb(v_link);
  end if;

  insert into public.trip_studio_links (
    trip_id, studio_id, studio_name, studio_city, status,
    requested_by_user_id, source_type
  ) values (
    p_trip_id, p_studio_id, v_studio.name, v_studio.city,
    'esperando_confirmacion', auth.uid(), 'manual'
  ) returning * into v_link;

  update public.artist_trips
  set status = 'pendiente'
  where id = p_trip_id and status = 'planificado';

  return to_jsonb(v_link);
end;
$$;

create or replace function public.resolve_trip_studio_link(
  p_link_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.trip_studio_links%rowtype;
  v_trip public.artist_trips%rowtype;
  v_studio_owner_id uuid;
  v_new_status text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('confirm', 'reject') then
    raise exception 'invalid action' using errcode = '22023';
  end if;

  select l.*
    into v_link
  from public.trip_studio_links l
  join public.artist_trips t on t.id = l.trip_id
  where l.id = p_link_id
  for update of l;
  if not found then
    raise exception 'studio link not found' using errcode = 'P0002';
  end if;

  select s.user_id into v_studio_owner_id
  from public.studios s where s.id = v_link.studio_id;

  if auth.uid() is distinct from v_studio_owner_id and not public.is_support_user() then
    raise exception 'studio link not found' using errcode = '42501';
  end if;
  if v_link.status <> 'esperando_confirmacion' then
    raise exception 'studio link is already resolved' using errcode = '23514';
  end if;

  v_new_status := case when p_action = 'confirm' then 'confirmada' else 'rechazada' end;
  update public.trip_studio_links
  set status = v_new_status,
      resolved_at = now(),
      resolved_by_user_id = auth.uid()
  where id = p_link_id
  returning * into v_link;

  select * into v_trip from public.artist_trips where id = v_link.trip_id for update;

  if v_new_status = 'confirmada' then
    update public.artist_trips set status = 'confirmado' where id = v_link.trip_id;
    insert into public.trip_events (trip_id, event_type, detail, event_date)
    values (v_link.trip_id, 'estudio_confirmado', v_link.studio_name, current_date);
    update public.trip_checklist_items
    set is_done = true
    where trip_id = v_link.trip_id
      and lower(label) in ('estudio confirmado', 'confirmar estudio');
  else
    update public.artist_trips t
    set status = case
      when exists (select 1 from public.trip_studio_links x where x.trip_id = t.id and x.status = 'confirmada') then 'confirmado'
      when exists (select 1 from public.trip_studio_links x where x.trip_id = t.id and x.status = 'esperando_confirmacion') then 'pendiente'
      else 'planificado'
    end
    where t.id = v_link.trip_id;
  end if;

  return jsonb_build_object(
    'link_id', v_link.id,
    'trip_id', v_link.trip_id,
    'status', v_new_status,
    'resolved_at', v_link.resolved_at
  );
end;
$$;

revoke all on function public.request_trip_studio_link(uuid, uuid) from public, anon;
revoke all on function public.resolve_trip_studio_link(uuid, text) from public, anon;
grant execute on function public.request_trip_studio_link(uuid, uuid) to authenticated, service_role;
grant execute on function public.resolve_trip_studio_link(uuid, text) to authenticated, service_role;

-- Optional explicit end date for time-bounded studio invitations. Existing
-- invitations continue to work; absent values use a one-week guest visit.
alter table public.studio_membership_invitation_details
  add column if not exists proposed_end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.studio_membership_invitation_details'::regclass
      and conname = 'smid_proposed_dates_check'
  ) then
    alter table public.studio_membership_invitation_details
      add constraint smid_proposed_dates_check
      check (
        proposed_end_date is null
        or proposed_start_date is null
        or proposed_end_date >= proposed_start_date
      );
  end if;
end;
$$;

create or replace function public.create_trip_from_accepted_spot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spot public.studio_spots%rowtype;
  v_studio public.studios%rowtype;
  v_city text;
  v_country text;
  v_start date;
  v_end date;
  v_trip_id uuid;
begin
  if new.status <> 'accepted'
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select * into v_spot from public.studio_spots where id = new.spot_id;
  select * into v_studio from public.studios where id = v_spot.studio_id;
  select coalesce(sl.city, v_studio.city), coalesce(sl.country, v_studio.country)
    into v_city, v_country
  from (select 1) seed
  left join public.studio_locations sl on sl.id = v_spot.location_id;

  v_start := coalesce(lower(new.requested_dates)::date, v_spot.start_date, current_date);
  v_end := coalesce((upper(new.requested_dates) - interval '1 day')::date, v_spot.end_date, v_start);
  if v_end < v_start then v_end := v_start; end if;

  insert into public.artist_trips (
    artist_user_id, city, country, region, start_date, end_date,
    trip_type, status, origin, studio_name_hint, agreed_conditions,
    source_type, source_id
  ) values (
    new.artist_user_id, coalesce(v_city, 'Por confirmar'), coalesce(v_country, 'Por confirmar'),
    null, v_start, v_end,
    case when v_spot.kind = 'resident' then 'estudio_invitado' else 'guest_spot' end,
    'confirmado', 'automatico', v_studio.name,
    case when v_spot.revenue_split_pct is null then null
      else 'Split ' || trim(to_char(v_spot.revenue_split_pct, 'FM999990D00')) || '% para el artista.' end,
    'spot_application', new.id
  ) on conflict do nothing;

  select id into v_trip_id from public.artist_trips
  where source_type = 'spot_application' and source_id = new.id;

  if v_trip_id is not null then
    insert into public.trip_studio_links (
      trip_id, studio_id, studio_name, studio_city, status,
      requested_by_user_id, resolved_by_user_id, resolved_at,
      source_type, source_id
    ) values (
      v_trip_id, v_studio.id, v_studio.name, v_city, 'confirmada',
      new.artist_user_id, coalesce(new.decided_by_user_id, v_studio.user_id), coalesce(new.decided_at, now()),
      'spot_application', new.id
    ) on conflict do nothing;

    insert into public.trip_checklist_items (trip_id, label, is_done, sort_order)
    select v_trip_id, x.label, x.done, x.sort_order
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
    ) as x(label, done, sort_order)
    where not exists (
      select 1 from public.trip_checklist_items i
      where i.trip_id = v_trip_id and i.label = x.label
    );

    insert into public.trip_events (trip_id, event_type, detail, event_date)
    select v_trip_id, 'estudio_confirmado', v_studio.name, current_date
    where not exists (
      select 1 from public.trip_events e
      where e.trip_id = v_trip_id and e.event_type = 'estudio_confirmado'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_trip_from_accepted_spot on public.studio_spot_applications;
create trigger trg_create_trip_from_accepted_spot
  after insert or update on public.studio_spot_applications
  for each row execute function public.create_trip_from_accepted_spot();

create or replace function public.create_trip_from_accepted_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_detail public.studio_membership_invitation_details%rowtype;
  v_studio public.studios%rowtype;
  v_city text;
  v_country text;
  v_trip_id uuid;
  v_end date;
begin
  if new.status <> 'active'
     or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select * into v_detail
  from public.studio_membership_invitation_details where membership_id = new.id;
  if not found or v_detail.proposed_start_date is null then
    return new;
  end if;

  select * into v_studio from public.studios where id = new.studio_id;
  select coalesce(sl.city, v_studio.city), coalesce(sl.country, v_studio.country)
    into v_city, v_country
  from (select 1) seed
  left join public.studio_locations sl on sl.id = new.location_id;
  v_end := coalesce(v_detail.proposed_end_date, v_detail.proposed_start_date + 6);

  insert into public.artist_trips (
    artist_user_id, city, country, start_date, end_date, trip_type,
    status, origin, studio_name_hint, agreed_conditions,
    source_type, source_id
  ) values (
    new.artist_user_id, coalesce(v_city, 'Por confirmar'), coalesce(v_country, 'Por confirmar'),
    v_detail.proposed_start_date, v_end,
    case when new.role = 'guest' then 'guest_spot' else 'estudio_invitado' end,
    'confirmado', 'automatico', v_studio.name,
    case when new.revenue_split_pct is null then v_detail.message
      else 'Split ' || trim(to_char(new.revenue_split_pct, 'FM999990D00')) || '% para el artista.' end,
    'studio_invitation', new.id
  ) on conflict do nothing;

  select id into v_trip_id from public.artist_trips
  where source_type = 'studio_invitation' and source_id = new.id;

  if v_trip_id is not null then
    insert into public.trip_studio_links (
      trip_id, studio_id, studio_name, studio_city, status,
      requested_by_user_id, resolved_by_user_id, resolved_at,
      source_type, source_id
    ) values (
      v_trip_id, v_studio.id, v_studio.name, v_city, 'confirmada',
      new.artist_user_id, coalesce(new.invited_by_user_id, v_studio.user_id), now(),
      'studio_invitation', new.id
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_trip_from_accepted_invitation on public.studio_artist_memberships;
create trigger trg_create_trip_from_accepted_invitation
  after insert or update on public.studio_artist_memberships
  for each row execute function public.create_trip_from_accepted_invitation();

-- Limited public projection consumed by the artist public profile. It never
-- exposes notes, documents, checklist items, contact data or pending links.
create or replace view public.artist_public_travel_presences
with (security_barrier = true)
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
join public.trip_studio_links l on l.trip_id = t.id and l.status = 'confirmada'
join public.studios s on s.id = l.studio_id and s.is_active = true
left join public.studio_locations sl on sl.id = s.primary_location_id
where t.status in ('confirmado', 'finalizado')
  and t.cancelled_at is null;

revoke all on table public.artist_public_travel_presences from public;
grant select on table public.artist_public_travel_presences to anon, authenticated, service_role;

comment on view public.artist_public_travel_presences is
  'Public, minimal confirmed Travel presence for artist profiles. Pending links and private itinerary data are excluded.';
comment on function public.request_trip_studio_link(uuid, uuid) is
  'Artist-owned request point. Creates only an awaiting-confirmation link to an active owned We Otzi studio.';
comment on function public.resolve_trip_studio_link(uuid, text) is
  'Studio owner/support decision point. Artists cannot confirm or reject their own Travel link.';

-- Trigger functions are not callable endpoints.
revoke execute on function public.guard_trip_studio_link_transition() from public, anon, authenticated;
revoke execute on function public.audit_trip_studio_link_transition() from public, anon, authenticated;
revoke execute on function public.guard_artist_trip_confirmation() from public, anon, authenticated;
revoke execute on function public.create_trip_from_accepted_spot() from public, anon, authenticated;
revoke execute on function public.create_trip_from_accepted_invitation() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
