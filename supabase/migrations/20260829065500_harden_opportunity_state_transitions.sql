-- Close stale invitation negotiations and reject invalid opportunity lifecycle
-- transitions at the database boundary.

create or replace function public.respond_to_studio_invitation(
  p_membership_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'reject') then
    raise exception 'invalid invitation action' using errcode = '22023';
  end if;

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id
  for update;

  if not found or v_membership.artist_user_id <> auth.uid() then
    raise exception 'invitation not found' using errcode = '42501';
  end if;
  if v_membership.status not in ('pending_invite', 'pending_acceptance') then
    raise exception 'invitation already answered' using errcode = '23514';
  end if;

  update public.studio_artist_memberships
  set status = case when p_action = 'accept' then 'active' else 'rejected' end,
      started_at = case when p_action = 'accept' then coalesce(started_at, v_now) else started_at end,
      ended_at = case when p_action = 'reject' then v_now else null end,
      updated_at = v_now
  where id = p_membership_id;

  update public.studio_invitation_change_requests
  set status = 'superseded', resolved_at = v_now
  where membership_id = p_membership_id
    and status = 'pending';

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', case when p_action = 'accept' then 'active' else 'rejected' end,
    'responded_at', v_now
  );
end;
$$;

create or replace function public.end_studio_membership(
  p_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membership public.studio_artist_memberships%rowtype;
  v_is_studio_owner boolean := false;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_membership
  from public.studio_artist_memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.studios s
    where s.id = v_membership.studio_id and s.user_id = auth.uid()
  ) into v_is_studio_owner;

  if v_membership.artist_user_id <> auth.uid()
     and not v_is_studio_owner
     and not public.is_support_user() then
    raise exception 'membership not found' using errcode = '42501';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'only an active membership can be ended' using errcode = '23514';
  end if;

  update public.studio_artist_memberships
  set status = 'ended', ended_at = v_now, updated_at = v_now
  where id = p_membership_id;

  update public.studio_invitation_change_requests
  set status = 'superseded', resolved_at = v_now
  where membership_id = p_membership_id
    and status = 'pending';

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', 'ended',
    'ended_at', v_now
  );
end;
$$;

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

  if not found or v_application.status not in ('pending', 'viewed', 'shortlisted') then
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

revoke all on function public.respond_to_studio_invitation(uuid, text) from public, anon;
revoke all on function public.end_studio_membership(uuid) from public, anon;
revoke all on function public.create_studio_spot_counter_offer(uuid, text, numeric, date, date, text) from public, anon;
grant execute on function public.respond_to_studio_invitation(uuid, text) to authenticated;
grant execute on function public.end_studio_membership(uuid) to authenticated;
grant execute on function public.create_studio_spot_counter_offer(uuid, text, numeric, date, date, text) to authenticated;
