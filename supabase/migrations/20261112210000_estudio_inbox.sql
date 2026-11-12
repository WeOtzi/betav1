-- Inbox del estudio + respuesta a solicitudes de cambio (ronda 3, 12 nov 2026).
--
-- Hoy el artista escribe al estudio ("Escribir al estudio", 2007:5795), se
-- postula a spots, pide vincular viajes y recibe invitaciones/contratos: todos
-- esos hilos viven en inbox_threads con context->>'studio_id', pero nadie del
-- lado estudio los lee. Además, las solicitudes de cambio de una invitación
-- (studio_invitation_change_requests, 801:1101) no se muestran ni se responden.
--
-- Modelo (reutiliza el inbox unificado, sin tablas nuevas):
--   * El estudio lo opera su cuenta dueña (studios.user_id), igual que el resto
--     del panel /studio/dashboard y las policies vigentes (sam_*, sicr_*, smid_*).
--   * Un hilo es "del estudio" si su context_type es uno de los de estudio y
--     context->>'studio_id' (o context_id en studio_contact) apunta al estudio.
--     Los hilos de Job Board son artista↔cliente: no entran.
--   * Para responder, el dueño se suma como participante 'studio' del hilo
--     (open_studio_inbox_thread). A partir de ahí valen las RPC y policies que
--     ya existen: send_inbox_message, mark_inbox_thread_read,
--     set_inbox_thread_flags, RLS de inbox_messages y del bucket
--     inbox-attachments (carpeta <thread>/<uid>).
--   * Backfill: hilos creados cuando el estudio todavía no tenía cuenta quedaron
--     sin participante estudio; se agregan.
--   * request_studio_invitation_changes además publica el pedido en el hilo de
--     la invitación (misma firma, mismos errores).
--   * respond_studio_invitation_change_request: el estudio actualiza la
--     invitación (rol, sede, split, fechas, duración, mensaje) o mantiene las
--     condiciones, y la respuesta queda en el hilo.
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261112210000_estudio_inbox.down.sql

create schema if not exists private;

-- ── Helpers ───────────────────────────────────────────────────────────────
create or replace function private.studio_inbox_context_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['studio_contact', 'studio_spot_application', 'studio_invitation',
               'studio_contract', 'trip_studio_link']::text[];
$$;

-- Estudio al que pertenece un hilo (null si no es un hilo de estudio).
create or replace function private.inbox_thread_studio_id(
  p_context_type text, p_context_id uuid, p_context jsonb
)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_context_type is null
      or not (p_context_type = any (private.studio_inbox_context_types())) then null
    when coalesce(p_context ->> 'studio_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (p_context ->> 'studio_id')::uuid
    when p_context_type = 'studio_contact' then p_context_id
    else null
  end;
$$;

create or replace function private.is_studio_owner(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.studios s
    where s.id = p_studio_id and s.user_id = auth.uid()
  );
$$;

revoke all on function private.studio_inbox_context_types() from public, anon, authenticated;
revoke all on function private.inbox_thread_studio_id(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.is_studio_owner(uuid) from public, anon, authenticated;

create index if not exists idx_inbox_threads_studio_ctx
  on public.inbox_threads ((context ->> 'studio_id'));

-- ── Listado del inbox del estudio ─────────────────────────────────────────
create or replace function public.list_studio_inbox_threads(p_studio_id uuid)
returns table (
  id uuid, category text, context_type text, context_id uuid,
  artist_user_id uuid, artist_name text, artist_username text, artist_avatar text,
  subject text, context jsonb, status text, is_priority boolean,
  last_message text, last_message_at timestamptz, last_sender_role text,
  is_participant boolean, is_favorite boolean, is_archived boolean,
  unread_count bigint, pending_change_request jsonb, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not private.is_studio_owner(p_studio_id) then
    raise exception 'No tenés acceso al inbox de este estudio.' using errcode = '42501';
  end if;

  return query
  select
    t.id, t.category, t.context_type, t.context_id,
    t.artist_user_id,
    coalesce(nullif(btrim(a.name), ''), nullif(btrim(a.username), ''), 'Artista') as artist_name,
    a.username as artist_username,
    a.profile_picture as artist_avatar,
    t.subject, t.context, t.status, t.is_priority,
    t.last_message, t.last_message_at,
    (select m.sender_role from public.inbox_messages m
      where m.thread_id = t.id
      order by m.created_at desc, m.id desc limit 1) as last_sender_role,
    (p.user_id is not null) as is_participant,
    coalesce(p.is_favorite, false) as is_favorite,
    coalesce(p.is_archived, false) as is_archived,
    (select count(*) from public.inbox_messages m
      where m.thread_id = t.id
        and m.sender_user_id is distinct from auth.uid()
        and m.sender_role <> 'studio'
        and m.created_at >= coalesce(p.last_read_at, '-infinity'::timestamptz))::bigint as unread_count,
    (select jsonb_build_object('id', r.id, 'message', r.message, 'created_at', r.created_at)
      from public.studio_invitation_change_requests r
      where t.context_type = 'studio_invitation'
        and r.membership_id = t.context_id
        and r.status = 'pending'
      limit 1) as pending_change_request,
    t.created_at
  from public.inbox_threads t
  left join public.inbox_thread_participants p
    on p.thread_id = t.id and p.user_id = auth.uid()
  left join public.artists_db a on a.user_id = t.artist_user_id
  where (t.context ->> 'studio_id' = p_studio_id::text
         or (t.context_type = 'studio_contact' and t.context_id = p_studio_id))
    and t.context_type = any (private.studio_inbox_context_types())
    and private.inbox_thread_studio_id(t.context_type, t.context_id, t.context) = p_studio_id
    and t.artist_user_id is distinct from auth.uid()
  order by coalesce(t.last_message_at, t.created_at) desc, t.id;
end;
$$;

-- ── Abrir un hilo como estudio (alta de participante + leído) ─────────────
create or replace function public.open_studio_inbox_thread(p_studio_id uuid, p_thread_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_thread public.inbox_threads%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if not private.is_studio_owner(p_studio_id) then
    raise exception 'No tenés acceso al inbox de este estudio.' using errcode = '42501';
  end if;

  select * into v_thread from public.inbox_threads where id = p_thread_id;
  if not found
     or private.inbox_thread_studio_id(v_thread.context_type, v_thread.context_id, v_thread.context) is distinct from p_studio_id
     or v_thread.artist_user_id = auth.uid() then
    raise exception 'thread not found' using errcode = '42501';
  end if;

  insert into public.inbox_thread_participants (thread_id, user_id, participant_role, last_read_at)
  values (p_thread_id, auth.uid(), 'studio', v_now)
  on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

  if v_thread.counterparty_user_id is null then
    update public.inbox_threads
    set counterparty_user_id = auth.uid(), updated_at = now()
    where id = p_thread_id;
  end if;

  insert into public.inbox_thread_activity (thread_id, actor_user_id, event_type)
  values (p_thread_id, auth.uid(), 'read');

  return jsonb_build_object('thread_id', p_thread_id, 'participant_role', 'studio', 'read_at', v_now);
end;
$$;

-- ── Hilo de la invitación (lo crea si no existe) ──────────────────────────
create or replace function private.studio_invitation_thread_id(p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread_id uuid;
  v_membership public.studio_artist_memberships%rowtype;
  v_studio public.studios%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
begin
  select * into v_membership from public.studio_artist_memberships where id = p_membership_id;
  if not found then return null; end if;

  select t.id into v_thread_id
  from public.inbox_threads t
  where t.artist_user_id = v_membership.artist_user_id
    and t.context_type = 'studio_invitation'
    and t.context_id = p_membership_id;

  select * into v_studio from public.studios where id = v_membership.studio_id;

  if v_thread_id is null then
    select * into v_detail from public.studio_membership_invitation_details where membership_id = p_membership_id;
    v_thread_id := public.ensure_domain_inbox_thread(
      v_membership.artist_user_id, 'invitations', 'studio_invitation', p_membership_id,
      v_studio.user_id, v_studio.name,
      coalesce(v_detail.duration_label, 'Invitación al estudio'),
      jsonb_build_object(
        'membership_id', p_membership_id, 'studio_id', v_studio.id, 'studio_name', v_studio.name,
        'role', v_membership.role, 'membership_status', v_membership.status,
        'initiated_by', v_membership.initiated_by
      ),
      null
    );
  elsif v_studio.user_id is not null and v_studio.user_id <> v_membership.artist_user_id then
    insert into public.inbox_thread_participants (thread_id, user_id, participant_role, last_read_at)
    values (v_thread_id, v_studio.user_id, 'studio', null)
    on conflict (thread_id, user_id) do nothing;
  end if;

  return v_thread_id;
end;
$$;

revoke all on function private.studio_invitation_thread_id(uuid) from public, anon, authenticated;

-- ── Pedido de cambios del artista: además lo publica en el hilo ───────────
create or replace function public.request_studio_invitation_changes(p_membership_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artist_id uuid;
  v_request_id uuid;
  v_thread_id uuid;
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

  -- El estudio lo ve en su inbox (hilo de la invitación).
  v_thread_id := private.studio_invitation_thread_id(p_membership_id);
  if v_thread_id is not null then
    insert into public.inbox_messages (thread_id, sender_user_id, sender_role, body, message_kind, created_at)
    values (v_thread_id, v_artist_id, 'artist', 'Solicitud de cambios: ' || btrim(p_message), 'text', clock_timestamp());
    update public.inbox_threads
    set context = context || jsonb_build_object('change_request_id', v_request_id, 'change_request_status', 'pending'),
        updated_at = now()
    where id = v_thread_id;
  end if;

  return jsonb_build_object(
    'request_id', v_request_id,
    'membership_id', p_membership_id,
    'status', 'pending',
    'thread_id', v_thread_id
  );
end;
$$;

-- ── Solicitudes de cambio para el panel del estudio ───────────────────────
create or replace function public.list_studio_invitation_change_requests(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_studio_owner(p_studio_id) then
    raise exception 'No tenés acceso a este estudio.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'membership_id', r.membership_id,
      'message', r.message,
      'status', r.status,
      'created_at', r.created_at,
      'resolved_at', r.resolved_at,
      'membership', jsonb_build_object(
        'id', m.id, 'role', m.role, 'status', m.status, 'location_id', m.location_id,
        'revenue_split_pct', m.revenue_split_pct, 'invited_at', m.invited_at,
        'has_contract', (m.current_contract_id is not null or exists (
          select 1 from public.studio_contracts c where c.membership_id = m.id and c.status = 'sent'))
      ),
      'details', case when d.membership_id is null then null else jsonb_build_object(
        'proposed_start_date', d.proposed_start_date, 'proposed_end_date', d.proposed_end_date,
        'duration_label', d.duration_label, 'message', d.message, 'response_due_at', d.response_due_at
      ) end,
      'artist', jsonb_build_object(
        'user_id', a.user_id, 'name', a.name, 'username', a.username,
        'city', a.city, 'country', a.country, 'profile_picture', a.profile_picture
      ),
      'thread_id', (select t.id from public.inbox_threads t
        where t.artist_user_id = m.artist_user_id and t.context_type = 'studio_invitation'
          and t.context_id = m.id limit 1)
    ) order by (r.status = 'pending') desc, r.created_at desc)
    from public.studio_invitation_change_requests r
    join public.studio_artist_memberships m on m.id = r.membership_id
    left join public.studio_membership_invitation_details d on d.membership_id = m.id
    left join public.artists_db a on a.user_id = m.artist_user_id
    where m.studio_id = p_studio_id
  ), '[]'::jsonb);
end;
$$;

-- ── Respuesta del estudio a una solicitud de cambio ───────────────────────
-- p_decision: 'accepted' (actualiza la invitación con p_changes) o
--             'declined' (mantiene las condiciones; p_reply obligatorio).
-- p_changes admite: role, location_id, revenue_split_pct, proposed_start_date,
--   proposed_end_date, duration_label, message. Cualquier otra clave se rechaza.
create or replace function public.respond_studio_invitation_change_request(
  p_request_id uuid,
  p_decision text,
  p_reply text default null,
  p_changes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.studio_invitation_change_requests%rowtype;
  v_membership public.studio_artist_memberships%rowtype;
  v_studio public.studios%rowtype;
  v_detail public.studio_membership_invitation_details%rowtype;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_key text;
  v_role text;
  v_location uuid;
  v_split numeric;
  v_start date;
  v_end date;
  v_duration text;
  v_message text;
  v_has_contract boolean;
  v_summary text[] := array[]::text[];
  v_thread_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'declined') then
    raise exception 'Elegí si actualizás la invitación o mantenés las condiciones.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_changes) <> 'object' then
    raise exception 'Cambios inválidos.' using errcode = '22023';
  end if;
  if v_reply is not null and char_length(v_reply) > 2000 then
    raise exception 'La respuesta puede tener hasta 2000 caracteres.' using errcode = '22023';
  end if;
  if p_decision = 'declined' and char_length(coalesce(v_reply, '')) < 10 then
    raise exception 'Contale al artista por qué mantenés las condiciones (mínimo 10 caracteres).' using errcode = '22023';
  end if;

  select * into v_request
  from public.studio_invitation_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = '42501';
  end if;

  select * into v_membership from public.studio_artist_memberships where id = v_request.membership_id;
  select * into v_studio from public.studios where id = v_membership.studio_id;
  if v_studio.user_id is distinct from auth.uid() then
    raise exception 'Solicitud no encontrada.' using errcode = '42501';
  end if;

  perform private.lock_studio_artist_pair(v_membership.studio_id, v_membership.artist_user_id);
  select * into v_membership from public.studio_artist_memberships where id = v_request.membership_id for update;

  if v_request.status <> 'pending' then
    raise exception 'Esta solicitud ya fue respondida.' using errcode = '23514';
  end if;
  if v_membership.status not in ('pending_invite', 'pending_acceptance') then
    raise exception 'La invitación ya no está pendiente.' using errcode = '23514';
  end if;

  if p_decision = 'accepted' then
    for v_key in select jsonb_object_keys(v_changes) loop
      if v_key not in ('role', 'location_id', 'revenue_split_pct', 'proposed_start_date',
                       'proposed_end_date', 'duration_label', 'message') then
        raise exception 'Campo no editable: %', v_key using errcode = '22023';
      end if;
    end loop;

    select * into v_detail from public.studio_membership_invitation_details where membership_id = v_membership.id;
    v_has_contract := v_membership.current_contract_id is not null or exists (
      select 1 from public.studio_contracts c where c.membership_id = v_membership.id and c.status = 'sent');

    v_role := case when v_changes ? 'role' then nullif(btrim(v_changes ->> 'role'), '') else v_membership.role end;
    if v_role is null or v_role not in ('resident', 'itinerant', 'guest', 'manager') then
      raise exception 'Rol inválido.' using errcode = '22023';
    end if;

    v_location := case when v_changes ? 'location_id' then nullif(v_changes ->> 'location_id', '')::uuid else v_membership.location_id end;
    if v_location is not null and v_location is distinct from v_membership.location_id and not exists (
      select 1 from public.studio_locations l
      where l.id = v_location and l.studio_id = v_membership.studio_id and l.is_active
    ) then
      raise exception 'La sede no pertenece al estudio.' using errcode = '22023';
    end if;

    v_split := case when v_changes ? 'revenue_split_pct' then nullif(v_changes ->> 'revenue_split_pct', '')::numeric else v_membership.revenue_split_pct end;
    if v_split is not null and (v_split < 0 or v_split > 100) then
      raise exception 'El reparto debe estar entre 0 y 100.' using errcode = '22023';
    end if;

    if v_has_contract and (v_role is distinct from v_membership.role or v_split is distinct from v_membership.revenue_split_pct) then
      raise exception 'El rol y el reparto se editan con una nueva versión del contrato.' using errcode = '23514';
    end if;

    v_start := case when v_changes ? 'proposed_start_date' then nullif(v_changes ->> 'proposed_start_date', '')::date else v_detail.proposed_start_date end;
    v_end := case when v_changes ? 'proposed_end_date' then nullif(v_changes ->> 'proposed_end_date', '')::date else v_detail.proposed_end_date end;
    if v_start is not null and v_end is not null and v_end < v_start then
      raise exception 'La fecha de fin no puede ser anterior al inicio.' using errcode = '22023';
    end if;
    if v_start is distinct from v_detail.proposed_start_date and v_start is not null and v_start < current_date then
      raise exception 'La fecha de inicio no puede estar en el pasado.' using errcode = '22023';
    end if;

    v_duration := case when v_changes ? 'duration_label' then nullif(btrim(v_changes ->> 'duration_label'), '') else v_detail.duration_label end;
    if char_length(coalesce(v_duration, '')) > 80 then
      raise exception 'La duración puede tener hasta 80 caracteres.' using errcode = '22023';
    end if;
    v_message := case when v_changes ? 'message' then nullif(btrim(v_changes ->> 'message'), '') else v_detail.message end;
    if char_length(coalesce(v_message, '')) > 2000 then
      raise exception 'El mensaje puede tener hasta 2000 caracteres.' using errcode = '22023';
    end if;

    if v_role is distinct from v_membership.role then
      v_summary := v_summary || ('rol ' || case v_role when 'resident' then 'Residente' when 'itinerant' then 'Itinerante'
        when 'guest' then 'Guest' else 'Manager' end);
    end if;
    if v_location is distinct from v_membership.location_id then
      v_summary := v_summary || ('sede ' || coalesce((select coalesce(l.label, 'Sede') from public.studio_locations l where l.id = v_location), 'sin asignar'));
    end if;
    if v_split is distinct from v_membership.revenue_split_pct then
      v_summary := v_summary || ('reparto ' || coalesce(rtrim(rtrim(to_char(v_split, 'FM990.00'), '0'), '.') || '%', 'a definir'));
    end if;
    if v_start is distinct from v_detail.proposed_start_date or v_end is distinct from v_detail.proposed_end_date then
      v_summary := v_summary || ('fechas ' || coalesce(to_char(v_start, 'DD/MM/YYYY'), 'a definir') || ' – ' || coalesce(to_char(v_end, 'DD/MM/YYYY'), 'a definir'));
    end if;
    if v_duration is distinct from v_detail.duration_label then
      v_summary := v_summary || ('duración ' || coalesce(v_duration, 'a definir'));
    end if;
    if v_message is distinct from v_detail.message then
      v_summary := v_summary || 'mensaje de la invitación';
    end if;

    if cardinality(v_summary) = 0 then
      raise exception 'No hay cambios: si mantenés las condiciones, respondé sin actualizar.' using errcode = '22023';
    end if;

    update public.studio_artist_memberships
    set role = v_role, location_id = v_location, revenue_split_pct = v_split, updated_at = v_now
    where id = v_membership.id
      and (role, location_id, revenue_split_pct) is distinct from (v_role, v_location, v_split);

    insert into public.studio_membership_invitation_details (
      membership_id, proposed_start_date, proposed_end_date, duration_label, message
    ) values (
      v_membership.id, v_start, v_end, v_duration, v_message
    )
    on conflict (membership_id) do update set
      proposed_start_date = excluded.proposed_start_date,
      proposed_end_date = excluded.proposed_end_date,
      duration_label = excluded.duration_label,
      message = excluded.message,
      updated_at = v_now;
  end if;

  update public.studio_invitation_change_requests
  set status = p_decision, resolved_at = v_now
  where id = v_request.id;

  v_thread_id := private.studio_invitation_thread_id(v_membership.id);
  if v_thread_id is not null then
    insert into public.inbox_messages (thread_id, sender_role, body, message_kind, created_at)
    values (
      v_thread_id, 'system',
      case when p_decision = 'accepted'
        then coalesce(nullif(btrim(v_studio.name), ''), 'El estudio') || ' actualizó la invitación: ' || array_to_string(v_summary, ' · ') || '.'
        else coalesce(nullif(btrim(v_studio.name), ''), 'El estudio') || ' mantuvo las condiciones de la invitación.'
      end,
      'system', clock_timestamp()
    );
    if v_reply is not null then
      insert into public.inbox_messages (thread_id, sender_user_id, sender_role, body, message_kind, created_at)
      values (v_thread_id, auth.uid(), 'studio', v_reply, 'text', clock_timestamp());
    end if;

    -- El estudio queda como participante y con lo propio ya leído.
    insert into public.inbox_thread_participants (thread_id, user_id, participant_role, last_read_at)
    values (v_thread_id, auth.uid(), 'studio', clock_timestamp())
    on conflict (thread_id, user_id) do update set last_read_at = excluded.last_read_at;

    update public.inbox_threads
    set context = context || jsonb_build_object('change_request_id', v_request.id, 'change_request_status', p_decision),
        updated_at = now()
    where id = v_thread_id;
  end if;

  return jsonb_build_object(
    'request_id', v_request.id,
    'membership_id', v_membership.id,
    'status', p_decision,
    'changes', to_jsonb(v_summary),
    'thread_id', v_thread_id,
    'resolved_at', v_now
  );
end;
$$;

-- ── Backfill: el dueño actual del estudio participa de sus hilos ──────────
insert into public.inbox_thread_participants (thread_id, user_id, participant_role, last_read_at)
select t.id, s.user_id, 'studio', null
from public.inbox_threads t
join public.studios s
  on s.id = private.inbox_thread_studio_id(t.context_type, t.context_id, t.context)
where t.context_type = any (private.studio_inbox_context_types())
  and s.user_id is not null
  and s.user_id <> t.artist_user_id
on conflict (thread_id, user_id) do nothing;

update public.inbox_threads t
set counterparty_user_id = s.user_id
from public.studios s
where t.counterparty_user_id is null
  and t.context_type = any (private.studio_inbox_context_types())
  and s.id = private.inbox_thread_studio_id(t.context_type, t.context_id, t.context)
  and s.user_id is not null
  and s.user_id <> t.artist_user_id;

-- ── Permisos ──────────────────────────────────────────────────────────────
revoke all on function public.list_studio_inbox_threads(uuid) from public, anon;
revoke all on function public.open_studio_inbox_thread(uuid, uuid) from public, anon;
revoke all on function public.list_studio_invitation_change_requests(uuid) from public, anon;
revoke all on function public.respond_studio_invitation_change_request(uuid, text, text, jsonb) from public, anon;
revoke all on function public.request_studio_invitation_changes(uuid, text) from public, anon;
grant execute on function public.list_studio_inbox_threads(uuid) to authenticated;
grant execute on function public.open_studio_inbox_thread(uuid, uuid) to authenticated;
grant execute on function public.list_studio_invitation_change_requests(uuid) to authenticated;
grant execute on function public.respond_studio_invitation_change_request(uuid, text, text, jsonb) to authenticated;
grant execute on function public.request_studio_invitation_changes(uuid, text) to authenticated;
