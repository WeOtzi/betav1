-- ============================================================================
-- Verificación de artistas de punta a punta (beta cerrada · frente verif-artista)
-- Hallazgos VER-A1, VER-A2, VER-A5, VER-A7 y VER-A8 (auditoría de verificación).
--
-- 1. support_set_artist_verification_state(user, estado, nota) → jsonb
--    Soporte decide (Yes / Denied / Requested / No) y queda historial en
--    verification_history (approved / rejected / pending_review / revoked) con
--    reviewed_by = auth.uid() del agente. Denegar o revocar exige motivo (≥5).
--    La firma vieja de 2 argumentos queda como envoltorio (devuelve text).
-- 2. request_artist_verification(user) → jsonb (SOLO service_role)
--    El servidor (POST /api/artist/verification/request) pasa al artista a
--    'Requested' si tiene identidad y domicilio cargados y no rechazados, y deja
--    la fila 'pending_review' en el historial. Todo en una transacción.
-- 3. support_list_verification_requests(estado, user) → cola por ARTISTA
--    (no por documento): un artista 'Requested' sin documentos también aparece.
-- 4. verification_history: lectura solo para soporte y para el propio artista;
--    nadie escribe desde la API (solo las funciones security definer).
-- 5. guard_artist_privileged_fields: pasar a 'Requested' por PATCH directo
--    exige los documentos obligatorios; se puede volver a pedir desde 'Canceled'.
--
-- Idempotente. Reversa: supabase/rollbacks/20261115190000_artist_verification_decision.down.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · Decisión de soporte con historial
-- ---------------------------------------------------------------------------
create or replace function public.support_set_artist_verification_state(
  p_artist_user_id uuid,
  p_state text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_artist_id uuid;
  v_previous text;
  v_action text;
  v_history_id uuid;
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede cambiar la verificación.' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('Yes', 'Denied', 'Requested', 'No') then
    raise exception 'Estado de verificación inválido.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'La nota puede tener hasta 500 caracteres.' using errcode = '22023';
  end if;

  select a.id, coalesce(a.verification_state, 'No')
    into v_artist_id, v_previous
    from public.artists_db a
   where a.user_id = p_artist_user_id
   for update;
  if not found then
    raise exception 'No encontramos ese artista.' using errcode = '22023';
  end if;

  if v_previous = p_state then
    return jsonb_build_object('state', p_state, 'previous_state', v_previous,
                              'history_id', null, 'action', null, 'changed', false);
  end if;

  if p_state = 'Denied' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Escribí el motivo para denegar (mínimo 5 caracteres). Lo ve el artista.' using errcode = '22023';
  end if;
  if p_state = 'No' and v_previous = 'Yes' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Escribí el motivo para revocar la verificación (mínimo 5 caracteres). Lo ve el artista.' using errcode = '22023';
  end if;

  update public.artists_db
     set verification_state = p_state
   where user_id = p_artist_user_id;

  v_action := case p_state
                when 'Yes' then 'approved'
                when 'Denied' then 'rejected'
                when 'Requested' then 'pending_review'
                else 'revoked'
              end;

  insert into public.verification_history (artist_id, action, notes, reviewed_by)
  values (v_artist_id, v_action, v_note, auth.uid()::text)
  returning id into v_history_id;

  return jsonb_build_object('state', p_state, 'previous_state', v_previous,
                            'history_id', v_history_id, 'action', v_action, 'changed', true);
end;
$$;

revoke all on function public.support_set_artist_verification_state(uuid, text, text) from public, anon;
grant execute on function public.support_set_artist_verification_state(uuid, text, text) to authenticated, service_role;

-- Firma vieja (panel anterior): misma regla y mismo historial; devuelve el estado.
create or replace function public.support_set_artist_verification_state(
  p_artist_user_id uuid,
  p_state text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.support_set_artist_verification_state(p_artist_user_id, p_state, null::text) ->> 'state';
end;
$$;

revoke all on function public.support_set_artist_verification_state(uuid, text) from public, anon;
grant execute on function public.support_set_artist_verification_state(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Solicitud del artista (la llama el servidor con service_role)
-- ---------------------------------------------------------------------------
create or replace function public.request_artist_verification(p_artist_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artist_id uuid;
  v_state text;
  v_missing text[];
  v_history_id uuid;
begin
  if p_artist_user_id is null then
    raise exception 'Falta el artista.' using errcode = '22023';
  end if;

  select a.id, coalesce(a.verification_state, 'No')
    into v_artist_id, v_state
    from public.artists_db a
   where a.user_id = p_artist_user_id
   for update;
  if not found then
    raise exception 'No encontramos tu perfil de artista.' using errcode = '22023';
  end if;

  if v_state = 'Yes' then
    raise exception 'Tu perfil ya está verificado.' using errcode = '22023';
  end if;
  if v_state in ('Requested', 'In Progress', 'In Analysis') then
    return jsonb_build_object('state', v_state, 'history_id', null, 'changed', false);
  end if;
  if v_state not in ('No', 'Denied', 'rejected', 'Canceled') then
    raise exception 'No podés solicitar la verificación en este momento.' using errcode = '22023';
  end if;

  select array_agg(req.label order by req.ord)
    into v_missing
    from (values (1, 'identidad', 'tu documento de identidad'),
                 (2, 'domicilio', 'tu comprobante de domicilio')) as req(ord, doc_type, label)
   where not exists (
     select 1 from public.artist_verification_documents d
      where d.artist_user_id = p_artist_user_id
        and d.doc_type = req.doc_type
        and d.status <> 'rechazado');
  if v_missing is not null then
    raise exception 'Antes de solicitarla, subí %.', array_to_string(v_missing, ' y ') using errcode = '22023';
  end if;

  update public.artists_db
     set verification_state = 'Requested'
   where user_id = p_artist_user_id;

  insert into public.verification_history (artist_id, action, notes, reviewed_by)
  values (v_artist_id, 'pending_review', 'Solicitud del artista', null)
  returning id into v_history_id;

  return jsonb_build_object('state', 'Requested', 'previous_state', v_state,
                            'history_id', v_history_id, 'changed', true);
end;
$$;

revoke all on function public.request_artist_verification(uuid) from public, anon, authenticated;
grant execute on function public.request_artist_verification(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3 · Cola de soporte por artista
-- ---------------------------------------------------------------------------
create or replace function public.support_list_verification_requests(
  p_status text default 'pending',
  p_user_id uuid default null
)
returns table (
  user_id uuid,
  artist_id uuid,
  name text,
  username text,
  email text,
  city text,
  country text,
  profile_picture text,
  verification_state text,
  instagram_verified_at timestamptz,
  instagram_verified_handle text,
  requested_at timestamptz,
  last_decision_at timestamptz,
  last_decision_action text,
  last_decision_note text,
  documents jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not coalesce(public.is_support_user(), false) then
    raise exception 'Solo soporte puede ver la cola de verificación.' using errcode = '42501';
  end if;

  return query
  select a.user_id,
         a.id,
         a.name,
         a.username,
         a.email,
         a.city,
         a.country,
         a.profile_picture,
         coalesce(a.verification_state, 'No'),
         a.instagram_verified_at,
         a.instagram_verified_handle,
         req.requested_at,
         dec.created_at,
         dec.action,
         dec.notes,
         coalesce(docs.items, '[]'::jsonb)
    from public.artists_db a
    left join lateral (
      select max(h.created_at) as requested_at
        from public.verification_history h
       where h.artist_id = a.id and h.action = 'pending_review'
    ) req on true
    left join lateral (
      select h.created_at, h.action, h.notes
        from public.verification_history h
       where h.artist_id = a.id and h.action <> 'pending_review'
       order by h.created_at desc
       limit 1
    ) dec on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'doc_type', d.doc_type, 'status', d.status,
               'file_name', d.file_name, 'storage_path', d.storage_path,
               'uploaded_at', d.uploaded_at, 'reviewed_at', d.reviewed_at,
               'reviewer_notes', d.reviewer_notes) order by d.doc_type) as items
        from public.artist_verification_documents d
       where d.artist_user_id = a.user_id
    ) docs on true
   where a.user_id is not null
     and (
       (p_user_id is not null and a.user_id = p_user_id)
       or (p_user_id is null and (
             (coalesce(p_status, 'pending') = 'pending' and a.verification_state in ('Requested', 'In Progress', 'In Analysis'))
          or (p_status = 'verified' and a.verification_state = 'Yes')
          or (p_status = 'rejected' and a.verification_state in ('Denied', 'rejected', 'Canceled'))
          or (p_status = 'all' and (coalesce(a.verification_state, 'No') <> 'No'
                                    or req.requested_at is not null or dec.created_at is not null))
       ))
     )
   order by coalesce(req.requested_at, dec.created_at) asc nulls first, a.name asc
   limit 300;
end;
$$;

revoke all on function public.support_list_verification_requests(text, uuid) from public, anon;
grant execute on function public.support_list_verification_requests(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · verification_history: solo lectura (soporte y el propio artista)
-- ---------------------------------------------------------------------------
alter table public.verification_history enable row level security;

drop policy if exists "Allow authenticated insert on verification_history" on public.verification_history;
drop policy if exists "Allow authenticated read on verification_history" on public.verification_history;
drop policy if exists verification_history_support_select on public.verification_history;
drop policy if exists verification_history_owner_select on public.verification_history;

create policy verification_history_support_select
  on public.verification_history
  for select to authenticated
  using (public.is_support_user());

create policy verification_history_owner_select
  on public.verification_history
  for select to authenticated
  using (exists (
    select 1 from public.artists_db a
     where a.id = verification_history.artist_id
       and a.user_id = (select auth.uid())
  ));

revoke all on table public.verification_history from anon;
revoke insert, update, delete, truncate, references, trigger on table public.verification_history from authenticated;
grant select on table public.verification_history to authenticated;
grant all on table public.verification_history to service_role;

create index if not exists verification_history_artist_created_idx
  on public.verification_history (artist_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5 · Guard: pedir la verificación exige los documentos obligatorios
-- ---------------------------------------------------------------------------
create or replace function public.guard_artist_privileged_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.wo_is_privileged_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.verification_state, 'No') not in ('No', 'Requested') then
      raise exception 'La verificación la gestiona We Ötzi.' using errcode = '42501';
    end if;
    if coalesce(new.verification_state, 'No') = 'Requested' and (
         select count(distinct d.doc_type)
           from public.artist_verification_documents d
          where d.artist_user_id = new.user_id
            and d.doc_type in ('identidad', 'domicilio')
            and d.status <> 'rechazado') < 2 then
      raise exception 'Para solicitar la verificación subí tu documento de identidad y tu comprobante de domicilio.' using errcode = '42501';
    end if;
    if coalesce(new.is_recommended, false) then
      raise exception 'La recomendación la gestiona We Ötzi.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.verification_state is distinct from old.verification_state then
    if not (new.verification_state = 'Requested'
            and coalesce(old.verification_state, 'No') in ('No', 'Denied', 'rejected', 'Canceled')) then
      raise exception 'La verificación la gestiona We Ötzi.' using errcode = '42501';
    end if;
    if (select count(distinct d.doc_type)
          from public.artist_verification_documents d
         where d.artist_user_id = new.user_id
           and d.doc_type in ('identidad', 'domicilio')
           and d.status <> 'rechazado') < 2 then
      raise exception 'Para solicitar la verificación subí tu documento de identidad y tu comprobante de domicilio.' using errcode = '42501';
    end if;
  end if;

  if new.is_recommended is distinct from old.is_recommended then
    raise exception 'La recomendación la gestiona We Ötzi.' using errcode = '42501';
  end if;

  return new;
end;
$$;

commit;
