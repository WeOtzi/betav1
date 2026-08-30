-- Private offer data for artist invitations and auditable artist responses.
-- Contact and commercial terms intentionally live outside the public active
-- roster row (`studio_artist_memberships`).

create table if not exists public.studio_membership_invitation_details (
  membership_id uuid primary key
    references public.studio_artist_memberships(id) on delete cascade,
  is_featured boolean not null default false,
  styles text[] not null default array[]::text[],
  response_due_at timestamptz,
  proposed_start_date date,
  duration_label text,
  benefits text[] not null default array[]::text[],
  studio_provides text[] not null default array[]::text[],
  artist_expectations text[] not null default array[]::text[],
  requirements text[] not null default array[]::text[],
  acceptance_steps text[] not null default array[]::text[],
  contact_name text,
  contact_email text,
  contact_title text,
  message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_smid_featured_pending
  on public.studio_membership_invitation_details (is_featured, response_due_at)
  where is_featured = true;

create table if not exists public.studio_invitation_change_requests (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null
    references public.studio_artist_memberships(id) on delete cascade,
  artist_user_id uuid not null
    references public.artists_db(user_id) on delete cascade,
  message text not null,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  constraint studio_invitation_change_requests_message_length
    check (char_length(btrim(message)) between 10 and 1000),
  constraint studio_invitation_change_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'superseded'))
);

create index if not exists idx_sicr_membership_created
  on public.studio_invitation_change_requests (membership_id, created_at desc);

create unique index if not exists idx_sicr_one_pending_per_membership
  on public.studio_invitation_change_requests (membership_id)
  where status = 'pending';

alter table public.studio_membership_invitation_details enable row level security;
alter table public.studio_invitation_change_requests enable row level security;

drop policy if exists smid_parties_select on public.studio_membership_invitation_details;
create policy smid_parties_select
on public.studio_membership_invitation_details
for select
using (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (
        m.artist_user_id = (select auth.uid())
        or s.user_id = (select auth.uid())
        or public.is_support_user()
      )
  )
);

drop policy if exists smid_studio_support_write on public.studio_membership_invitation_details;
create policy smid_studio_support_write
on public.studio_membership_invitation_details
for all
using (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
)
with check (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
);

drop policy if exists sicr_parties_select on public.studio_invitation_change_requests;
create policy sicr_parties_select
on public.studio_invitation_change_requests
for select
using (
  artist_user_id = (select auth.uid())
  or exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
);

drop policy if exists sicr_studio_support_update on public.studio_invitation_change_requests;
create policy sicr_studio_support_update
on public.studio_invitation_change_requests
for update
using (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
)
with check (
  exists (
    select 1
    from public.studio_artist_memberships m
    join public.studios s on s.id = m.studio_id
    where m.id = membership_id
      and (s.user_id = (select auth.uid()) or public.is_support_user())
  )
);

-- Artists may read their invitation, but membership terms can only be mutated
-- by the studio/support or through the guarded response RPC below.
drop policy if exists sam_studio_or_artist_write on public.studio_artist_memberships;
drop policy if exists sam_studio_or_support_write on public.studio_artist_memberships;
create policy sam_studio_or_support_write
on public.studio_artist_memberships
for all
using (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.studios s
      where s.id = studio_artist_memberships.studio_id
        and s.user_id = (select auth.uid())
    )
    or public.is_support_user()
  )
)
with check (
  auth.uid() is not null
  and (
    exists (
      select 1 from public.studios s
      where s.id = studio_artist_memberships.studio_id
        and s.user_id = (select auth.uid())
    )
    or public.is_support_user()
  )
);

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
      is_active = (p_action = 'accept'),
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

create or replace function public.request_studio_invitation_changes(
  p_membership_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artist_id uuid;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 1000 then
    raise exception 'message must contain 10 to 1000 characters' using errcode = '22023';
  end if;

  select artist_user_id into v_artist_id
  from public.studio_artist_memberships
  where id = p_membership_id
    and artist_user_id = auth.uid()
    and status in ('pending_invite', 'pending_acceptance')
  for update;

  if not found then
    raise exception 'pending invitation not found' using errcode = '42501';
  end if;

  insert into public.studio_invitation_change_requests (
    membership_id, artist_user_id, message
  ) values (
    p_membership_id, v_artist_id, btrim(p_message)
  )
  on conflict (membership_id) where status = 'pending'
  do update set message = excluded.message, created_at = timezone('utc', now())
  returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'membership_id', p_membership_id,
    'status', 'pending'
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
  set status = 'ended', is_active = false, ended_at = v_now, updated_at = v_now
  where id = p_membership_id;

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'status', 'ended',
    'ended_at', v_now
  );
end;
$$;

revoke all on public.studio_membership_invitation_details from anon;
revoke all on public.studio_invitation_change_requests from anon;
grant select, insert, update, delete on public.studio_membership_invitation_details to authenticated;
grant select, update on public.studio_invitation_change_requests to authenticated;

revoke all on function public.respond_to_studio_invitation(uuid, text) from public, anon;
revoke all on function public.request_studio_invitation_changes(uuid, text) from public, anon;
revoke all on function public.end_studio_membership(uuid) from public, anon;
grant execute on function public.respond_to_studio_invitation(uuid, text) to authenticated;
grant execute on function public.request_studio_invitation_changes(uuid, text) to authenticated;
grant execute on function public.end_studio_membership(uuid) to authenticated;

comment on table public.studio_membership_invitation_details is
  'Private invitation offer content rendered in the artist invitation experience.';
comment on table public.studio_invitation_change_requests is
  'Auditable artist requests to change a pending studio invitation.';
