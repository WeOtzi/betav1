-- `studio_artist_memberships.is_active` is generated from status. Keep RPCs
-- focused on source columns so they work on the live generated-column schema.

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
  if v_membership.status not in ('active', 'paused', 'pending_invite', 'pending_acceptance') then
    raise exception 'membership cannot be ended from its current status' using errcode = '23514';
  end if;

  update public.studio_artist_memberships
  set status = 'ended', ended_at = v_now, updated_at = v_now
  where id = p_membership_id;

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', 'ended',
    'ended_at', v_now
  );
end;
$$;
