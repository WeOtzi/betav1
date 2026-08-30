-- Unified, persistent artist Inbox backing Figma 144:1250.
-- Keeps quotation/support legacy tables intact while providing one secure
-- conversation contract for Clients, Quotes, Support, Invitations, Spots,
-- Job Board, Studios and Travel.

begin;

create table if not exists public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in (
    'clients', 'quotations', 'support', 'invitations', 'spots',
    'job_board', 'studios', 'trips'
  )),
  context_type text,
  context_id uuid,
  counterparty_user_id uuid references auth.users(id) on delete set null,
  counterparty_name text not null,
  counterparty_initials text,
  subject text,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'closed')),
  is_priority boolean not null default false,
  last_message text,
  last_message_at timestamptz,
  last_sender_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_inbox_threads_domain_once
  on public.inbox_threads (artist_user_id, context_type, context_id)
  where context_type is not null and context_id is not null;
create index if not exists idx_inbox_threads_artist_recent
  on public.inbox_threads (artist_user_id, last_message_at desc nulls last, created_at desc);
create index if not exists idx_inbox_threads_counterparty
  on public.inbox_threads (counterparty_user_id, last_message_at desc)
  where counterparty_user_id is not null;

create table if not exists public.inbox_thread_participants (
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_role text not null check (participant_role in (
    'artist', 'client', 'studio', 'support'
  )),
  last_read_at timestamptz,
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_inbox_participants_user
  on public.inbox_thread_participants (user_id, is_archived, is_favorite);

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in (
    'artist', 'client', 'studio', 'support', 'system'
  )),
  body text,
  message_kind text not null default 'text'
    check (message_kind in ('text', 'image', 'file', 'system')),
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint,
  client_nonce uuid,
  created_at timestamptz not null default now(),
  constraint inbox_messages_content_check check (
    nullif(btrim(coalesce(body, '')), '') is not null
    or attachment_path is not null
  ),
  constraint inbox_messages_attachment_size_check check (
    attachment_size is null or attachment_size between 0 and 15728640
  )
);

create index if not exists idx_inbox_messages_thread_time
  on public.inbox_messages (thread_id, created_at, id);
create unique index if not exists idx_inbox_messages_sender_nonce
  on public.inbox_messages (sender_user_id, client_nonce)
  where sender_user_id is not null and client_nonce is not null;

create table if not exists public.inbox_thread_activity (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'message_sent', 'read', 'favorited', 'unfavorited',
    'archived', 'unarchived', 'closed', 'reopened'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbox_activity_thread_time
  on public.inbox_thread_activity (thread_id, created_at desc);

alter table public.inbox_threads enable row level security;
alter table public.inbox_thread_participants enable row level security;
alter table public.inbox_messages enable row level security;
alter table public.inbox_thread_activity enable row level security;

create or replace function public.is_inbox_thread_participant(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.inbox_thread_participants p
    where p.thread_id = p_thread_id and p.user_id = auth.uid()
  );
$$;

drop policy if exists inbox_threads_participant_select on public.inbox_threads;
create policy inbox_threads_participant_select
  on public.inbox_threads for select to authenticated
  using (
    public.is_inbox_thread_participant(id)
    or public.is_support_user()
  );

drop policy if exists inbox_threads_support_write on public.inbox_threads;
create policy inbox_threads_support_write
  on public.inbox_threads for all to authenticated
  using (public.is_support_user())
  with check (public.is_support_user());

drop policy if exists inbox_participants_parties_select on public.inbox_thread_participants;
create policy inbox_participants_parties_select
  on public.inbox_thread_participants for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_inbox_thread_participant(thread_id)
    or public.is_support_user()
  );

drop policy if exists inbox_participants_self_update on public.inbox_thread_participants;
create policy inbox_participants_self_update
  on public.inbox_thread_participants for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists inbox_messages_participant_select on public.inbox_messages;
create policy inbox_messages_participant_select
  on public.inbox_messages for select to authenticated
  using (
    public.is_inbox_thread_participant(thread_id)
    or public.is_support_user()
  );

drop policy if exists inbox_messages_participant_insert on public.inbox_messages;
create policy inbox_messages_participant_insert
  on public.inbox_messages for insert to authenticated
  with check (
    sender_user_id = (select auth.uid())
    and sender_role <> 'system'
    and public.is_inbox_thread_participant(thread_id)
  );

drop policy if exists inbox_activity_participant_select on public.inbox_thread_activity;
create policy inbox_activity_participant_select
  on public.inbox_thread_activity for select to authenticated
  using (
    public.is_inbox_thread_participant(thread_id)
    or public.is_support_user()
  );

revoke all on table public.inbox_threads from anon, authenticated;
revoke all on table public.inbox_thread_participants from anon, authenticated;
revoke all on table public.inbox_messages from anon, authenticated;
revoke all on table public.inbox_thread_activity from anon, authenticated;
grant select on table public.inbox_threads to authenticated;
grant select, update on table public.inbox_thread_participants to authenticated;
grant select on table public.inbox_messages to authenticated;
grant select on table public.inbox_thread_activity to authenticated;
grant select, insert, update, delete on table public.inbox_threads to service_role;
grant select, insert, update, delete on table public.inbox_thread_participants to service_role;
grant select, insert, update, delete on table public.inbox_messages to service_role;
grant select, insert, update, delete on table public.inbox_thread_activity to service_role;

create or replace function public.guard_inbox_participant_update()
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

  if new.thread_id is distinct from old.thread_id
     or new.user_id is distinct from old.user_id
     or new.participant_role is distinct from old.participant_role
     or new.joined_at is distinct from old.joined_at then
    raise exception 'participant identity is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_inbox_participant_update on public.inbox_thread_participants;
create trigger trg_guard_inbox_participant_update
  before update on public.inbox_thread_participants
  for each row execute function public.guard_inbox_participant_update();

create or replace function public.touch_inbox_message_thread()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.inbox_threads
  set last_message = case
        when nullif(btrim(coalesce(new.body, '')), '') is not null then left(new.body, 240)
        when new.message_kind = 'image' then 'Imagen adjunta'
        else coalesce(new.attachment_name, 'Archivo adjunto')
      end,
      last_message_at = new.created_at,
      last_sender_user_id = new.sender_user_id,
      updated_at = now()
  where id = new.thread_id;

  insert into public.inbox_thread_activity (
    thread_id, actor_user_id, event_type, metadata
  ) values (
    new.thread_id, new.sender_user_id, 'message_sent',
    jsonb_build_object('message_id', new.id, 'kind', new.message_kind)
  );
  return new;
end;
$$;

drop trigger if exists trg_touch_inbox_message_thread on public.inbox_messages;
create trigger trg_touch_inbox_message_thread
  after insert on public.inbox_messages
  for each row execute function public.touch_inbox_message_thread();

create or replace function public.list_artist_inbox_threads()
returns table (
  id uuid,
  category text,
  context_type text,
  context_id uuid,
  counterparty_name text,
  counterparty_initials text,
  subject text,
  context jsonb,
  status text,
  is_priority boolean,
  last_message text,
  last_message_at timestamptz,
  last_sender_user_id uuid,
  is_favorite boolean,
  is_archived boolean,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id, t.category, t.context_type, t.context_id,
    t.counterparty_name, t.counterparty_initials, t.subject, t.context,
    t.status, t.is_priority, t.last_message, t.last_message_at,
    t.last_sender_user_id, p.is_favorite, p.is_archived,
    (
      select count(*)
      from public.inbox_messages m
      where m.thread_id = t.id
        and m.created_at > coalesce(p.last_read_at, p.joined_at)
        and m.sender_user_id is distinct from auth.uid()
    )::bigint as unread_count
  from public.inbox_threads t
  join public.inbox_thread_participants p
    on p.thread_id = t.id and p.user_id = auth.uid()
  where auth.uid() is not null
  order by coalesce(t.last_message_at, t.created_at) desc, t.id;
$$;

create or replace function public.send_inbox_message(
  p_thread_id uuid,
  p_body text default null,
  p_attachment_path text default null,
  p_attachment_name text default null,
  p_attachment_mime text default null,
  p_attachment_size bigint default null,
  p_client_nonce uuid default null
)
returns public.inbox_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_message public.inbox_messages%rowtype;
  v_kind text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select participant_role into v_role
  from public.inbox_thread_participants
  where thread_id = p_thread_id and user_id = auth.uid();
  if not found then
    raise exception 'thread not found' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_body, '')), '') is null and p_attachment_path is null then
    raise exception 'message content is required' using errcode = '22023';
  end if;
  if p_attachment_size is not null and p_attachment_size > 15728640 then
    raise exception 'attachment is too large' using errcode = '22023';
  end if;
  if p_attachment_path is not null
     and split_part(p_attachment_path, '/', 1) <> p_thread_id::text then
    raise exception 'invalid attachment path' using errcode = '42501';
  end if;

  v_kind := case
    when p_attachment_path is null then 'text'
    when coalesce(p_attachment_mime, '') like 'image/%' then 'image'
    else 'file'
  end;

  insert into public.inbox_messages (
    thread_id, sender_user_id, sender_role, body, message_kind,
    attachment_path, attachment_name, attachment_mime, attachment_size,
    client_nonce
  ) values (
    p_thread_id, auth.uid(), v_role, nullif(btrim(coalesce(p_body, '')), ''), v_kind,
    p_attachment_path, p_attachment_name, p_attachment_mime, p_attachment_size,
    p_client_nonce
  )
  on conflict (sender_user_id, client_nonce)
    where sender_user_id is not null and client_nonce is not null
  do update set body = public.inbox_messages.body
  returning * into v_message;

  return v_message;
end;
$$;

create or replace function public.mark_inbox_thread_read(p_thread_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_read_at timestamptz := now();
begin
  update public.inbox_thread_participants
  set last_read_at = v_read_at
  where thread_id = p_thread_id and user_id = auth.uid();
  if not found then
    raise exception 'thread not found' using errcode = '42501';
  end if;

  insert into public.inbox_thread_activity (thread_id, actor_user_id, event_type)
  values (p_thread_id, auth.uid(), 'read');
  return v_read_at;
end;
$$;

create or replace function public.set_inbox_thread_flags(
  p_thread_id uuid,
  p_is_favorite boolean default null,
  p_is_archived boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.inbox_thread_participants%rowtype;
  v_after public.inbox_thread_participants%rowtype;
begin
  select * into v_before
  from public.inbox_thread_participants
  where thread_id = p_thread_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'thread not found' using errcode = '42501';
  end if;

  update public.inbox_thread_participants
  set is_favorite = coalesce(p_is_favorite, is_favorite),
      is_archived = coalesce(p_is_archived, is_archived)
  where thread_id = p_thread_id and user_id = auth.uid()
  returning * into v_after;

  if v_before.is_favorite is distinct from v_after.is_favorite then
    insert into public.inbox_thread_activity (thread_id, actor_user_id, event_type)
    values (p_thread_id, auth.uid(), case when v_after.is_favorite then 'favorited' else 'unfavorited' end);
  end if;
  if v_before.is_archived is distinct from v_after.is_archived then
    insert into public.inbox_thread_activity (thread_id, actor_user_id, event_type)
    values (p_thread_id, auth.uid(), case when v_after.is_archived then 'archived' else 'unarchived' end);
  end if;

  return jsonb_build_object(
    'thread_id', p_thread_id,
    'is_favorite', v_after.is_favorite,
    'is_archived', v_after.is_archived
  );
end;
$$;

-- Internal domain helper. Trigger-only: direct EXECUTE stays revoked.
create or replace function public.ensure_domain_inbox_thread(
  p_artist_user_id uuid,
  p_category text,
  p_context_type text,
  p_context_id uuid,
  p_counterparty_user_id uuid,
  p_counterparty_name text,
  p_subject text,
  p_context jsonb default '{}'::jsonb,
  p_system_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread_id uuid;
begin
  insert into public.inbox_threads (
    artist_user_id, category, context_type, context_id,
    counterparty_user_id, counterparty_name, counterparty_initials,
    subject, context
  ) values (
    p_artist_user_id, p_category, p_context_type, p_context_id,
    p_counterparty_user_id, coalesce(nullif(btrim(p_counterparty_name), ''), 'We Otzi'),
    upper(left(coalesce(nullif(btrim(p_counterparty_name), ''), 'WO'), 2)),
    p_subject, coalesce(p_context, '{}'::jsonb)
  )
  on conflict (artist_user_id, context_type, context_id)
    where context_type is not null and context_id is not null
  do update set
    category = excluded.category,
    counterparty_user_id = coalesce(excluded.counterparty_user_id, public.inbox_threads.counterparty_user_id),
    counterparty_name = excluded.counterparty_name,
    subject = coalesce(excluded.subject, public.inbox_threads.subject),
    context = public.inbox_threads.context || excluded.context,
    updated_at = now()
  returning id into v_thread_id;

  insert into public.inbox_thread_participants (
    thread_id, user_id, participant_role, last_read_at
  ) values (
    v_thread_id, p_artist_user_id, 'artist', now()
  ) on conflict (thread_id, user_id) do nothing;

  if p_counterparty_user_id is not null and p_counterparty_user_id <> p_artist_user_id then
    insert into public.inbox_thread_participants (
      thread_id, user_id, participant_role, last_read_at
    ) values (
      v_thread_id, p_counterparty_user_id,
      case when p_category in ('spots', 'invitations', 'studios', 'trips') then 'studio' else 'client' end,
      now()
    ) on conflict (thread_id, user_id) do nothing;
  end if;

  if nullif(btrim(coalesce(p_system_message, '')), '') is not null
     and not exists (
       select 1 from public.inbox_messages m
       where m.thread_id = v_thread_id
         and m.sender_role = 'system'
         and m.body = p_system_message
     ) then
    insert into public.inbox_messages (
      thread_id, sender_role, body, message_kind
    ) values (
      v_thread_id, 'system', p_system_message, 'system'
    );
  end if;

  return v_thread_id;
end;
$$;

revoke all on function public.is_inbox_thread_participant(uuid) from public, anon;
grant execute on function public.is_inbox_thread_participant(uuid) to authenticated, service_role;
revoke all on function public.list_artist_inbox_threads() from public, anon;
grant execute on function public.list_artist_inbox_threads() to authenticated, service_role;
revoke all on function public.send_inbox_message(uuid, text, text, text, text, bigint, uuid) from public, anon;
grant execute on function public.send_inbox_message(uuid, text, text, text, text, bigint, uuid) to authenticated, service_role;
revoke all on function public.mark_inbox_thread_read(uuid) from public, anon;
grant execute on function public.mark_inbox_thread_read(uuid) to authenticated, service_role;
revoke all on function public.set_inbox_thread_flags(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_inbox_thread_flags(uuid, boolean, boolean) to authenticated, service_role;
revoke all on function public.ensure_domain_inbox_thread(uuid, text, text, uuid, uuid, text, text, jsonb, text)
  from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inbox-attachments', 'inbox-attachments', false, 15728640,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inbox_attachments_participant_select on storage.objects;
create policy inbox_attachments_participant_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'inbox-attachments'
    and exists (
      select 1 from public.inbox_thread_participants p
      where p.thread_id::text = (storage.foldername(name))[1]
        and p.user_id = (select auth.uid())
    )
  );

drop policy if exists inbox_attachments_participant_insert on storage.objects;
create policy inbox_attachments_participant_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inbox-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.inbox_thread_participants p
      where p.thread_id::text = (storage.foldername(name))[1]
        and p.user_id = (select auth.uid())
    )
  );

drop policy if exists inbox_attachments_participant_delete on storage.objects;
create policy inbox_attachments_participant_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'inbox-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.inbox_thread_participants p
      where p.thread_id::text = (storage.foldername(name))[1]
        and p.user_id = (select auth.uid())
    )
  );

-- Domain triggers keep the unified Inbox in sync with product actions.
create or replace function public.inbox_from_trip_studio_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.artist_trips%rowtype;
  v_studio public.studios%rowtype;
  v_message text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into v_trip from public.artist_trips where id = new.trip_id;
  select * into v_studio from public.studios where id = new.studio_id;
  v_message := case new.status
    when 'esperando_confirmacion' then 'Solicitud de vinculación enviada. El estudio debe confirmarla o rechazarla.'
    when 'confirmada' then 'El estudio confirmó la vinculación. El viaje ya puede aparecer en tu perfil público.'
    when 'rechazada' then 'El estudio rechazó la vinculación del viaje.'
    else 'La solicitud de vinculación fue cancelada.'
  end;
  perform public.ensure_domain_inbox_thread(
    v_trip.artist_user_id, 'trips', 'trip_studio_link', new.id,
    v_studio.user_id, coalesce(v_studio.name, new.studio_name),
    'Viaje a ' || v_trip.city,
    jsonb_build_object(
      'trip_id', v_trip.id, 'city', v_trip.city, 'country', v_trip.country,
      'start_date', v_trip.start_date, 'end_date', v_trip.end_date,
      'studio_id', new.studio_id, 'studio_name', new.studio_name,
      'link_status', new.status
    ), v_message
  );
  return new;
end;
$$;

drop trigger if exists trg_inbox_from_trip_studio_link on public.trip_studio_links;
create trigger trg_inbox_from_trip_studio_link
  after insert or update on public.trip_studio_links
  for each row execute function public.inbox_from_trip_studio_link();

create or replace function public.inbox_from_spot_application()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spot public.studio_spots%rowtype;
  v_studio public.studios%rowtype;
  v_message text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into v_spot from public.studio_spots where id = new.spot_id;
  select * into v_studio from public.studios where id = v_spot.studio_id;
  v_message := case new.status
    when 'accepted' then 'Tu postulación fue aceptada. Coordinemos las fechas confirmadas por acá.'
    when 'rejected' then 'El estudio cerró esta postulación.'
    when 'shortlisted' then 'Tu postulación quedó preseleccionada.'
    else 'Postulación enviada al estudio.'
  end;
  perform public.ensure_domain_inbox_thread(
    new.artist_user_id, 'spots', 'studio_spot_application', new.id,
    v_studio.user_id, v_studio.name, v_spot.title,
    jsonb_build_object(
      'application_id', new.id, 'spot_id', v_spot.id, 'studio_id', v_studio.id,
      'studio_name', v_studio.name, 'start_date', v_spot.start_date,
      'end_date', v_spot.end_date, 'application_status', new.status
    ), v_message
  );
  return new;
end;
$$;

drop trigger if exists trg_inbox_from_spot_application on public.studio_spot_applications;
create trigger trg_inbox_from_spot_application
  after insert or update on public.studio_spot_applications
  for each row execute function public.inbox_from_spot_application();

create or replace function public.inbox_from_studio_invitation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_studio public.studios%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
  v_message text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into v_studio from public.studios where id = new.studio_id;
  select * into v_detail from public.studio_membership_invitation_details where membership_id = new.id;
  v_message := case new.status
    when 'active' then 'Invitación aceptada. Ya formás parte del roster del estudio.'
    when 'rejected' then 'La invitación fue rechazada.'
    when 'pending_invite' then 'Recibiste una nueva invitación del estudio.'
    else 'El estudio te invitó a sumarte a su roster.'
  end;
  perform public.ensure_domain_inbox_thread(
    new.artist_user_id, 'invitations', 'studio_invitation', new.id,
    v_studio.user_id, v_studio.name, coalesce(v_detail.duration_label, 'Invitación al estudio'),
    jsonb_build_object(
      'membership_id', new.id, 'studio_id', v_studio.id, 'studio_name', v_studio.name,
      'role', new.role, 'membership_status', new.status,
      'proposed_start_date', v_detail.proposed_start_date,
      'proposed_end_date', v_detail.proposed_end_date
    ), v_message
  );
  return new;
end;
$$;

drop trigger if exists trg_inbox_from_studio_invitation on public.studio_artist_memberships;
create trigger trg_inbox_from_studio_invitation
  after insert or update on public.studio_artist_memberships
  for each row execute function public.inbox_from_studio_invitation();

create or replace function public.inbox_from_job_board_application()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.job_board_requests%rowtype;
  v_message text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into v_request from public.job_board_requests where id = new.request_id;
  v_message := case new.status
    when 'accepted' then 'Tu propuesta fue aceptada. Podés coordinar los próximos pasos por acá.'
    when 'rejected' then 'La solicitud eligió otra propuesta.'
    when 'shortlisted' then 'Tu propuesta quedó preseleccionada.'
    else 'Propuesta enviada al Job Board.'
  end;
  perform public.ensure_domain_inbox_thread(
    new.artist_id, 'job_board', 'job_board_application', new.id,
    v_request.client_user_id,
    coalesce(v_request.client_display_name, 'Cliente de Job Board'),
    coalesce(v_request.display_title, v_request.tattoo_idea_description, 'Job Board'),
    jsonb_build_object(
      'application_id', new.id, 'request_id', v_request.id,
      'request_code', v_request.request_code, 'application_status', new.status,
      'budget_min', v_request.client_budget_min, 'budget_max', v_request.client_budget_max,
      'currency', v_request.client_budget_currency
    ), v_message
  );
  return new;
end;
$$;

drop trigger if exists trg_inbox_from_job_board_application on public.job_board_applications;
create trigger trg_inbox_from_job_board_application
  after insert or update on public.job_board_applications
  for each row execute function public.inbox_from_job_board_application();

-- Realtime delivery for messages and list-state changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_messages'
  ) then
    alter publication supabase_realtime add table public.inbox_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_threads'
  ) then
    alter publication supabase_realtime add table public.inbox_threads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_thread_participants'
  ) then
    alter publication supabase_realtime add table public.inbox_thread_participants;
  end if;
end;
$$;

comment on table public.inbox_threads is
  'Canonical cross-domain Inbox thread; quotation/support legacy sources remain intact as compatibility inputs.';
comment on function public.list_artist_inbox_threads() is
  'RLS-equivalent authenticated Inbox list with persistent unread/favorite/archive state.';

revoke execute on function public.guard_inbox_participant_update() from public, anon, authenticated;
revoke execute on function public.touch_inbox_message_thread() from public, anon, authenticated;
revoke execute on function public.inbox_from_trip_studio_link() from public, anon, authenticated;
revoke execute on function public.inbox_from_spot_application() from public, anon, authenticated;
revoke execute on function public.inbox_from_studio_invitation() from public, anon, authenticated;
revoke execute on function public.inbox_from_job_board_application() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
