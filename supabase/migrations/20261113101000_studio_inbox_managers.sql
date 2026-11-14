-- Managers del estudio en el inbox y en las solicitudes de cambio (ronda 3b, 13 nov 2026).
--
-- Decisión del dueño: además del dueño (studios.user_id), los MANAGERS del
-- estudio responden en el inbox del estudio. Un manager es una fila de
-- studio_artist_memberships con role = 'manager' y status = 'active' para ese
-- estudio (modelo vigente: 20260430000002; no hay otra tabla de staff).
--
-- Qué cambia (sobre 20261112210000_estudio_inbox.sql, sin tablas nuevas):
--   * private.studio_inbox_access(_for): 'owner' | 'manager' | null.
--     private.is_studio_inbox_member(studio_id): dueño o manager activo.
--   * list/open del inbox y list/respond de solicitudes de cambio usan
--     is_studio_inbox_member en vez de is_studio_owner. Al abrir un hilo, el
--     manager se suma como participante 'studio': desde ahí envía mensajes,
--     adjuntos (bucket inbox-attachments, carpeta <thread>/<uid>) y flags con
--     las RPC/policies existentes del inbox unificado.
--   * Límites del manager al responder solicitudes: no responde pedidos sobre su
--     propia membresía ni invitaciones con rol manager, no nombra managers y no
--     cambia el reparto (revenue_split_pct). Sede, fechas, duración, mensaje,
--     rol no-manager y "mantener condiciones" sí.
--   * public.list_my_studio_access(): estudios que la cuenta opera (dueño o
--     manager) para resolver "qué estudio es mío" en /studio/login y el panel.
--     El manager NO gana nada más: perfil, sedes, roster, spots, operaciones,
--     finanzas, contratos y configuración siguen con las policies del dueño.
--   * Revocación: si la membresía manager deja de estar activa (pausa, fin,
--     cambio de rol o borrado), se quitan sus participaciones 'studio' en los
--     hilos de ese estudio (pierde lectura, envío y adjuntos). Además, un guard
--     en inbox_messages rechaza mensajes 'studio' en hilos de estudio de quien
--     no es dueño ni manager activo (defensa en profundidad).
--   * Manager que también es artista: list_artist_inbox_threads ya excluye las
--     participaciones 'studio' (20261112220000); list_studio_inbox_threads
--     excluye los hilos donde él es el artista.
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261113101000_studio_inbox_managers.down.sql

create schema if not exists private;

-- ── Helpers de acceso ─────────────────────────────────────────────────────
create or replace function private.studio_inbox_access_for(p_studio_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_studio_id is null or p_user_id is null then null
    when exists (
      select 1 from public.studios s
      where s.id = p_studio_id and s.user_id = p_user_id
    ) then 'owner'
    when exists (
      select 1 from public.studio_artist_memberships m
      where m.studio_id = p_studio_id
        and m.artist_user_id = p_user_id
        and m.role = 'manager'
        and m.status = 'active'
    ) then 'manager'
    else null
  end;
$$;

create or replace function private.studio_inbox_access(p_studio_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.studio_inbox_access_for(p_studio_id, auth.uid());
$$;

create or replace function private.is_studio_inbox_member(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.studio_inbox_access_for(p_studio_id, auth.uid()) is not null;
$$;

revoke all on function private.studio_inbox_access_for(uuid, uuid) from public, anon, authenticated;
revoke all on function private.studio_inbox_access(uuid) from public, anon, authenticated;
revoke all on function private.is_studio_inbox_member(uuid) from public, anon, authenticated;

create index if not exists idx_sam_active_managers
  on public.studio_artist_memberships (studio_id, artist_user_id)
  where role = 'manager' and status = 'active';

-- ── Listado del inbox: dueño o manager activo ───────────────────────────────
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
  if not private.is_studio_inbox_member(p_studio_id) then
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

-- ── Abrir un hilo como estudio: dueño o manager activo ──────────────────────
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
  if not private.is_studio_inbox_member(p_studio_id) then
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

-- ── Solicitudes de cambio: dueño o manager activo ───────────────────────────
create or replace function public.list_studio_invitation_change_requests(p_studio_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_studio_inbox_member(p_studio_id) then
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
      -- Un manager no ve (ni responde) pedidos sobre su propia membresía.
      and (private.studio_inbox_access(p_studio_id) = 'owner' or m.artist_user_id is distinct from auth.uid())
  ), '[]'::jsonb);
end;
$$;

-- ── Respuesta a una solicitud: dueño o manager activo (con límites) ─────────
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
  v_access text;
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
  -- Dueño o manager activo del estudio (20261113101000).
  v_access := private.studio_inbox_access(v_membership.studio_id);
  if v_access is null then
    raise exception 'Solicitud no encontrada.' using errcode = '42501';
  end if;
  if v_access = 'manager' then
    if v_membership.artist_user_id = auth.uid() then
      raise exception 'Solicitud no encontrada.' using errcode = '42501';
    end if;
    if v_membership.role = 'manager' then
      raise exception 'Solo el dueño del estudio responde invitaciones de managers.' using errcode = '42501';
    end if;
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

    -- El manager no gana permisos de dueño: no nombra managers ni toca el reparto.
    if v_access = 'manager' and v_role = 'manager' then
      raise exception 'Solo el dueño del estudio puede invitar managers.' using errcode = '42501';
    end if;
    if v_access = 'manager' and v_split is distinct from v_membership.revenue_split_pct then
      raise exception 'Solo el dueño del estudio puede cambiar el reparto.' using errcode = '42501';
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

-- ── Qué estudios opera la cuenta (login y panel del estudio) ──────────────
create or replace function public.list_my_studio_access()
returns table (studio_id uuid, access text, name text, slug text, logo_image text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, x.access, s.name, s.slug, s.logo_image
  from (
    select s0.id as sid, 'owner'::text as access
    from public.studios s0
    where s0.user_id = auth.uid()
    union
    select m.studio_id, 'manager'::text
    from public.studio_artist_memberships m
    where m.artist_user_id = auth.uid()
      and m.role = 'manager'
      and m.status = 'active'
  ) x
  join public.studios s on s.id = x.sid
  where auth.uid() is not null
    -- Si es dueño y además manager del mismo estudio, cuenta como dueño.
    and (x.access = 'owner' or s.user_id is distinct from auth.uid())
  order by (x.access = 'owner') desc, s.name, s.id;
$$;

-- ── Revocación: el manager que deja de estar activo sale de los hilos ─────
create or replace function private.revoke_studio_manager_inbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (old.role = 'manager' and old.status = 'active') then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.role = 'manager' and new.status = 'active'
     and new.studio_id = old.studio_id and new.artist_user_id = old.artist_user_id then
    return null;
  end if;
  -- Sigue teniendo acceso (dueño u otra membresía manager activa): no se toca.
  if private.studio_inbox_access_for(old.studio_id, old.artist_user_id) is not null then
    return null;
  end if;

  delete from public.inbox_thread_participants p
  using public.inbox_threads t
  where p.thread_id = t.id
    and p.user_id = old.artist_user_id
    and p.participant_role = 'studio'
    and t.artist_user_id is distinct from old.artist_user_id
    and private.inbox_thread_studio_id(t.context_type, t.context_id, t.context) = old.studio_id;
  return null;
end;
$$;

revoke all on function private.revoke_studio_manager_inbox() from public, anon, authenticated;

drop trigger if exists trg_revoke_studio_manager_inbox on public.studio_artist_memberships;
create trigger trg_revoke_studio_manager_inbox
  after update of role, status, studio_id, artist_user_id or delete on public.studio_artist_memberships
  for each row execute function private.revoke_studio_manager_inbox();

-- ── Guard: solo dueño o manager activo escribe como 'studio' ──────────────
create or replace function private.guard_studio_inbox_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_studio_id uuid;
begin
  if new.sender_role is distinct from 'studio' or new.sender_user_id is null then
    return new;
  end if;
  select private.inbox_thread_studio_id(t.context_type, t.context_id, t.context)
    into v_studio_id
  from public.inbox_threads t
  where t.id = new.thread_id;
  if v_studio_id is null then
    return new;
  end if;
  if private.studio_inbox_access_for(v_studio_id, new.sender_user_id) is null then
    raise exception 'Ya no tenés acceso al inbox de este estudio.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_studio_inbox_message() from public, anon, authenticated;

drop trigger if exists trg_guard_studio_inbox_message on public.inbox_messages;
create trigger trg_guard_studio_inbox_message
  before insert on public.inbox_messages
  for each row execute function private.guard_studio_inbox_message();

-- ── Limpieza única: ex managers con participación 'studio' ────────────────
-- Solo borra participaciones de cuentas que hoy no son dueño ni manager activo
-- del estudio del hilo y que alguna vez fueron manager de ese estudio. Antes de
-- esta migración solo el dueño podía sumarse, así que en vivo debería ser 0.
delete from public.inbox_thread_participants p
using public.inbox_threads t
where p.thread_id = t.id
  and p.participant_role = 'studio'
  and t.artist_user_id is distinct from p.user_id
  and private.inbox_thread_studio_id(t.context_type, t.context_id, t.context) is not null
  and private.studio_inbox_access_for(
        private.inbox_thread_studio_id(t.context_type, t.context_id, t.context), p.user_id) is null
  and exists (
    select 1 from public.studio_artist_memberships m
    where m.studio_id = private.inbox_thread_studio_id(t.context_type, t.context_id, t.context)
      and m.artist_user_id = p.user_id
      and m.role = 'manager'
  );

-- ── Permisos ──────────────────────────────────────────────────────────────
revoke all on function public.list_studio_inbox_threads(uuid) from public, anon;
revoke all on function public.open_studio_inbox_thread(uuid, uuid) from public, anon;
revoke all on function public.list_studio_invitation_change_requests(uuid) from public, anon;
revoke all on function public.respond_studio_invitation_change_request(uuid, text, text, jsonb) from public, anon;
revoke all on function public.list_my_studio_access() from public, anon;
grant execute on function public.list_studio_inbox_threads(uuid) to authenticated;
grant execute on function public.open_studio_inbox_thread(uuid, uuid) to authenticated;
grant execute on function public.list_studio_invitation_change_requests(uuid) to authenticated;
grant execute on function public.respond_studio_invitation_change_request(uuid, text, text, jsonb) to authenticated;
grant execute on function public.list_my_studio_access() to authenticated;
