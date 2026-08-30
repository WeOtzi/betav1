-- Negotiation history for artist applications to Studio Spots.

alter table public.studio_spots
  add column if not exists contact_name text,
  add column if not exists contact_title text,
  add column if not exists response_sla_label text;

create table if not exists public.studio_spot_counter_offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.studio_spot_applications(id) on delete cascade,
  author_role text not null,
  split_pct numeric,
  proposed_start_date date,
  proposed_end_date date,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  constraint studio_spot_counter_offers_author_role_check
    check (author_role in ('artist', 'studio')),
  constraint studio_spot_counter_offers_split_check
    check (split_pct is null or split_pct between 0 and 100),
  constraint studio_spot_counter_offers_dates_check
    check (proposed_end_date is null or proposed_start_date is null or proposed_end_date >= proposed_start_date),
  constraint studio_spot_counter_offers_status_check
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  constraint studio_spot_counter_offers_has_change
    check (
      split_pct is not null
      or proposed_start_date is not null
      or proposed_end_date is not null
      or nullif(btrim(coalesce(note, '')), '') is not null
    )
);

create index if not exists idx_ssco_application_created
  on public.studio_spot_counter_offers (application_id, created_at desc);

create unique index if not exists idx_ssco_one_pending_per_author
  on public.studio_spot_counter_offers (application_id, author_role)
  where status = 'pending';

alter table public.studio_spot_counter_offers enable row level security;

create policy ssco_parties_select
on public.studio_spot_counter_offers
for select
using (
  exists (
    select 1
    from public.studio_spot_applications a
    join public.studio_spots sp on sp.id = a.spot_id
    join public.studios s on s.id = sp.studio_id
    where a.id = application_id
      and (
        a.artist_user_id = (select auth.uid())
        or s.user_id = (select auth.uid())
        or public.is_support_user()
      )
  )
);

create or replace function public.create_studio_spot_counter_offer(
  p_application_id uuid,
  p_author_role text,
  p_split_pct numeric default null,
  p_proposed_start_date date default null,
  p_proposed_end_date date default null,
  p_note text default null
)
returns public.studio_spot_counter_offers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application record;
  v_offer public.studio_spot_counter_offers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_author_role not in ('artist', 'studio') then
    raise exception 'invalid author role' using errcode = '22023';
  end if;

  select a.*, s.user_id as studio_owner_id into v_application
  from public.studio_spot_applications a
  join public.studio_spots sp on sp.id = a.spot_id
  join public.studios s on s.id = sp.studio_id
  where a.id = p_application_id
  for update of a;

  if not found or v_application.status in ('rejected', 'withdrawn') then
    raise exception 'application not available for negotiation' using errcode = '23514';
  end if;
  if p_author_role = 'artist' and v_application.artist_user_id <> auth.uid() then
    raise exception 'application not found' using errcode = '42501';
  end if;
  if p_author_role = 'studio'
     and v_application.studio_owner_id is distinct from auth.uid()
     and not public.is_support_user() then
    raise exception 'application not found' using errcode = '42501';
  end if;

  update public.studio_spot_counter_offers
  set status = 'superseded', decided_at = timezone('utc', now())
  where application_id = p_application_id
    and author_role = p_author_role
    and status = 'pending';

  insert into public.studio_spot_counter_offers (
    application_id, author_role, split_pct, proposed_start_date,
    proposed_end_date, note
  ) values (
    p_application_id, p_author_role, p_split_pct, p_proposed_start_date,
    p_proposed_end_date, nullif(btrim(coalesce(p_note, '')), '')
  ) returning * into v_offer;

  update public.studio_spot_applications
  set status = 'shortlisted', decided_at = null
  where id = p_application_id and status in ('pending', 'viewed');

  return v_offer;
end;
$$;

create or replace function public.respond_to_studio_spot_counter_offer(
  p_offer_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer record;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'invalid counter-offer action' using errcode = '22023';
  end if;

  select o.*, a.artist_user_id as applicant_artist_id, s.user_id as studio_owner_id
    into v_offer
  from public.studio_spot_counter_offers o
  join public.studio_spot_applications a on a.id = o.application_id
  join public.studio_spots sp on sp.id = a.spot_id
  join public.studios s on s.id = sp.studio_id
  where o.id = p_offer_id
  for update of o;

  if not found or v_offer.status <> 'pending' then
    raise exception 'pending counter-offer not found' using errcode = '23514';
  end if;
  if v_offer.author_role = 'studio' and v_offer.applicant_artist_id <> auth.uid() then
    raise exception 'counter-offer not found' using errcode = '42501';
  end if;
  if v_offer.author_role = 'artist'
     and v_offer.studio_owner_id is distinct from auth.uid()
     and not public.is_support_user() then
    raise exception 'counter-offer not found' using errcode = '42501';
  end if;

  update public.studio_spot_counter_offers
  set status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
      decided_at = v_now
  where id = p_offer_id;

  if p_action = 'accept' then
    update public.studio_spot_counter_offers
    set status = 'superseded', decided_at = v_now
    where application_id = v_offer.application_id
      and id <> p_offer_id
      and status = 'pending';

    update public.studio_spot_applications
    set status = 'accepted', decided_at = v_now
    where id = v_offer.application_id;
  end if;

  return jsonb_build_object(
    'offer_id', p_offer_id,
    'application_id', v_offer.application_id,
    'status', case when p_action = 'accept' then 'accepted' else 'rejected' end,
    'decided_at', v_now
  );
end;
$$;

revoke all on public.studio_spot_counter_offers from anon;
grant select on public.studio_spot_counter_offers to authenticated;

revoke all on function public.create_studio_spot_counter_offer(uuid, text, numeric, date, date, text) from public, anon;
revoke all on function public.respond_to_studio_spot_counter_offer(uuid, text) from public, anon;
grant execute on function public.create_studio_spot_counter_offer(uuid, text, numeric, date, date, text) to authenticated;
grant execute on function public.respond_to_studio_spot_counter_offer(uuid, text) to authenticated;

comment on table public.studio_spot_counter_offers is
  'Auditable artist/studio negotiation history for a Spot application.';
