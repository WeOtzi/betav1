-- Sesiones · confirmación del cliente, cambios acordados, ubicación y registro
-- (ronda 2 · frente "sesiones" · P28 y P27-sesión).
--
-- Pedido del dueño:
--   · Al agregar una sesión, el cliente la confirma o pide una modificación.
--   · Una vez aceptada queda agendada para ambos y se puede editar hasta 3 días
--     antes, solo con el acuerdo de las dos partes. Si no hay acuerdo (o ya
--     faltan menos de 3 días), se pide a soporte abrir una disputa.
--   · Las sesiones pasadas no se modifican: solo admiten disputas, y se pueden
--     calificar y dejar un registro (ambas partes).
--   · La sesión guarda dónde se hace (sede de un estudio, ubicación propia,
--     la que eligió el cliente o texto libre con Google Places), con la
--     dirección completa.
--
-- Contenido (aditivo e idempotente):
--   1) quotation_sessions: client_confirmation / client_confirmed_at y
--      location_kind / location_ref / location_place_id; location pasa de 120
--      a 300 caracteres (dirección completa).
--   2) quotation_session_change_requests  · solicitudes de cambio.
--   3) quotation_session_feedback         · calificación + registro por sesión.
--   4) quotation_session_disputes         · vínculo sesión ↔ ticket de disputa.
--   5) Guardas en la base (trigger sesiones_guard): el navegador del artista
--      nunca decide la confirmación del cliente, no cambia fecha/lugar de una
--      sesión confirmada sin acuerdo ni toca sesiones pasadas.
--   6) RPC solo service-role (el servidor valida al actor y manda los emails):
--      sesiones_confirm / _request_change / _respond_change / _withdraw_change
--      / _save_feedback / _open_dispute.
--   7) Turnos reservados online: nacen confirmados (trigger sobre
--      artist_booking_holds; no se toca confirm_artist_slot_hold).
--   8) Google Calendar: el cambio de confirmación marca la agenda como sucia
--      (trigger propio; no se tocan los de 20261115150000/160000).
--
-- Las sesiones que ya existen quedan 'confirmed' (ya estaban acordadas).
-- Reversa: supabase/rollbacks/20261116150000_sesiones_confirmacion_ubicacion.down.sql

begin;

-- 1) quotation_sessions ----------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quotation_sessions' and column_name = 'client_confirmation'
  ) then
    -- El default llena las filas existentes sin UPDATE por fila (no cambia
    -- updated_at ni dispara triggers); después las nuevas nacen 'pending'.
    alter table public.quotation_sessions add column client_confirmation text not null default 'confirmed';
    alter table public.quotation_sessions alter column client_confirmation set default 'pending';
  end if;
end $$;

alter table public.quotation_sessions
  add column if not exists client_confirmed_at timestamptz,
  add column if not exists location_kind text,
  add column if not exists location_ref uuid,
  add column if not exists location_place_id text;

alter table public.quotation_sessions drop constraint if exists quotation_sessions_client_confirmation_check;
alter table public.quotation_sessions add constraint quotation_sessions_client_confirmation_check
  check (client_confirmation in ('pending', 'confirmed', 'change_requested'));

alter table public.quotation_sessions drop constraint if exists quotation_sessions_location_kind_check;
alter table public.quotation_sessions add constraint quotation_sessions_location_kind_check
  check (location_kind is null or location_kind in ('studio', 'own', 'client', 'custom'));

alter table public.quotation_sessions drop constraint if exists quotation_sessions_location_place_check;
alter table public.quotation_sessions add constraint quotation_sessions_location_place_check
  check (location_place_id is null or char_length(location_place_id) <= 300);

-- "Estudio X - Av. Corrientes 2151, Buenos Aires, Argentina" no entra en 120.
alter table public.quotation_sessions drop constraint if exists quotation_sessions_location_length;
alter table public.quotation_sessions add constraint quotation_sessions_location_length
  check (location is null or (char_length(btrim(location)) >= 1 and char_length(btrim(location)) <= 300));

comment on column public.quotation_sessions.client_confirmation is
  'Confirmación del cliente: pending (propuesta del artista), confirmed (acordada), change_requested (el cliente pidió otra fecha en vez de confirmar).';
comment on column public.quotation_sessions.location_kind is
  'Origen de location: studio (studio_locations.id en location_ref), own (artist_tattoo_locations.id), client (sede elegida al cotizar) o custom (texto / Google Places).';

-- 2) Solicitudes de cambio ---------------------------------------------------------
create table if not exists public.quotation_session_change_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quotation_sessions(id) on delete cascade,
  quotation_id integer not null references public.quotations_db(id) on delete cascade,
  requested_by uuid not null,
  requested_by_role text not null,
  previous_date timestamptz not null,
  proposed_date timestamptz,
  proposed_duration_hours numeric,
  proposed_location text,
  proposed_location_kind text,
  proposed_location_ref uuid,
  proposed_location_place_id text,
  note text,
  status text not null default 'pending',
  responded_by uuid,
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotation_session_change_requests_role_check check (requested_by_role in ('client', 'artist')),
  constraint quotation_session_change_requests_status_check
    check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'superseded')),
  constraint quotation_session_change_requests_shape_check
    check (proposed_date is not null or proposed_duration_hours is not null or proposed_location is not null),
  constraint quotation_session_change_requests_duration_check
    check (proposed_duration_hours is null or (proposed_duration_hours >= 0.25 and proposed_duration_hours <= 24)),
  constraint quotation_session_change_requests_location_check
    check (proposed_location is null or (char_length(btrim(proposed_location)) >= 1 and char_length(btrim(proposed_location)) <= 300)),
  constraint quotation_session_change_requests_kind_check
    check (proposed_location_kind is null or proposed_location_kind in ('studio', 'own', 'client', 'custom')),
  constraint quotation_session_change_requests_note_check check (note is null or char_length(note) <= 1000),
  constraint quotation_session_change_requests_response_check check (response_note is null or char_length(response_note) <= 1000)
);

create unique index if not exists quotation_session_change_requests_one_pending
  on public.quotation_session_change_requests (session_id) where status = 'pending';
create index if not exists quotation_session_change_requests_session_idx
  on public.quotation_session_change_requests (session_id, created_at desc);
create index if not exists quotation_session_change_requests_quotation_idx
  on public.quotation_session_change_requests (quotation_id);

-- 3) Calificación y registro por sesión ---------------------------------------------
-- No es la reseña pública (verified_reviews sigue siendo la de la cotización
-- completada): es un registro privado entre las partes y soporte.
create table if not exists public.quotation_session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quotation_sessions(id) on delete cascade,
  quotation_id integer not null references public.quotations_db(id) on delete cascade,
  author_user_id uuid not null,
  author_role text not null,
  rating smallint not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotation_session_feedback_role_check check (author_role in ('client', 'artist')),
  constraint quotation_session_feedback_rating_check check (rating between 1 and 5),
  constraint quotation_session_feedback_note_check check (note is null or char_length(note) <= 2000),
  constraint quotation_session_feedback_one_per_role unique (session_id, author_role)
);
create index if not exists quotation_session_feedback_quotation_idx
  on public.quotation_session_feedback (quotation_id);

-- 4) Vínculo sesión ↔ ticket de disputa ---------------------------------------------
create table if not exists public.quotation_session_disputes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.quotation_sessions(id) on delete cascade,
  quotation_id integer not null references public.quotations_db(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  opened_by uuid not null,
  opened_by_role text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint quotation_session_disputes_role_check check (opened_by_role in ('client', 'artist')),
  constraint quotation_session_disputes_ticket_key unique (ticket_id)
);
create index if not exists quotation_session_disputes_session_idx
  on public.quotation_session_disputes (session_id, created_at desc);

-- Las tres tablas solo se leen y escriben desde el servidor (service-role):
-- RLS prendido sin policies y sin privilegios para anon/authenticated.
alter table public.quotation_session_change_requests enable row level security;
alter table public.quotation_session_feedback enable row level security;
alter table public.quotation_session_disputes enable row level security;
revoke all on public.quotation_session_change_requests from public, anon, authenticated;
revoke all on public.quotation_session_feedback from public, anon, authenticated;
revoke all on public.quotation_session_disputes from public, anon, authenticated;
grant select, insert, update, delete on public.quotation_session_change_requests to service_role;
grant select, insert, update, delete on public.quotation_session_feedback to service_role;
grant select, insert, update, delete on public.quotation_session_disputes to service_role;

-- 5) Guardas de quotation_sessions ----------------------------------------------------
-- auth.uid() no nulo = escritura directa del navegador (el artista, por RLS).
-- El servidor (service-role) y las RPC de este archivo no pasan por las reglas:
-- las RPC activan 'weotzi.sesiones_bypass' solo dentro de su transacción.
create or replace function public.sesiones_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_bypass boolean := coalesce(pg_catalog.current_setting('weotzi.sesiones_bypass', true), '') = '1';
  v_client uuid;
  v_date_changed boolean;
  v_loc_changed boolean;
begin
  if tg_op = 'DELETE' then
    if v_bypass or v_uid is null then
      return old;
    end if;
    select q.client_user_id into v_client from public.quotations_db q where q.id = old.quotation_id;
    if v_client is null then
      return old;
    end if;
    if old.status <> 'cancelled'
       and (old.client_confirmation = 'confirmed' or old.session_date <= pg_catalog.now()) then
      raise exception using errcode = 'WOS03', message = 'SESSION_DELETE_BLOCKED',
        detail = 'Una sesión confirmada o pasada no se borra: se cancela o se disputa.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_bypass then
      return new;
    end if;
    select q.client_user_id into v_client from public.quotations_db q where q.id = new.quotation_id;
    if v_client is null
       or new.session_date <= pg_catalog.now()
       or new.status in ('completed', 'no_show', 'cancelled') then
      -- Sin cuenta de cliente no hay quién confirme; una sesión que ya pasó o
      -- nace cerrada es un registro, no una propuesta.
      new.client_confirmation := 'confirmed';
      if v_uid is not null then
        new.client_confirmed_at := null;
      end if;
    elsif v_uid is not null then
      new.client_confirmation := 'pending';
      new.client_confirmed_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if v_bypass or v_uid is null then
    return new;
  end if;

  -- El navegador nunca decide la confirmación del cliente.
  new.client_confirmation := old.client_confirmation;
  new.client_confirmed_at := old.client_confirmed_at;

  -- Registrar el resultado (realizada / ausencia) o cancelar sigue permitido.
  if new.status in ('completed', 'no_show', 'cancelled') then
    return new;
  end if;

  select q.client_user_id into v_client from public.quotations_db q where q.id = new.quotation_id;
  if v_client is null then
    return new;
  end if;

  -- Reabrir una sesión cerrada es una propuesta nueva para el cliente.
  if old.status in ('completed', 'no_show', 'cancelled') then
    if new.session_date > pg_catalog.now() then
      new.client_confirmation := 'pending';
      new.client_confirmed_at := null;
    end if;
    return new;
  end if;

  v_date_changed := new.session_date is distinct from old.session_date
    or coalesce(nullif(new.duration_hours, 0), 1) is distinct from coalesce(nullif(old.duration_hours, 0), 1);
  v_loc_changed := coalesce(pg_catalog.btrim(new.location), '') is distinct from coalesce(pg_catalog.btrim(old.location), '');
  if not v_date_changed and not v_loc_changed then
    return new;
  end if;

  if old.session_date <= pg_catalog.now() then
    raise exception using errcode = 'WOS02', message = 'SESSION_PAST',
      detail = 'Las sesiones pasadas no se pueden modificar.';
  end if;

  if old.client_confirmation = 'confirmed' then
    -- Completar por primera vez el lugar no cambia lo acordado.
    if v_date_changed or coalesce(pg_catalog.btrim(old.location), '') <> '' then
      raise exception using errcode = 'WOS01', message = 'SESSION_NEEDS_AGREEMENT',
        detail = 'La sesión ya está confirmada: el cambio lo tiene que aceptar la otra parte.';
    end if;
    return new;
  end if;

  -- Todavía no acordada: el artista la ajusta y el cliente vuelve a confirmar.
  new.client_confirmation := 'pending';
  new.client_confirmed_at := null;
  update public.quotation_session_change_requests r
     set status = 'superseded', updated_at = pg_catalog.now()
   where r.session_id = new.id and r.status = 'pending';
  return new;
end;
$$;

drop trigger if exists trg_sesiones_guard on public.quotation_sessions;
create trigger trg_sesiones_guard
  before insert or update or delete on public.quotation_sessions
  for each row execute function public.sesiones_guard();

-- Una sesión que se cierra deja sin efecto sus solicitudes pendientes.
create or replace function public.sesiones_close_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'completed', 'no_show') and old.status is distinct from new.status then
    update public.quotation_session_change_requests r
       set status = 'superseded', updated_at = pg_catalog.now()
     where r.session_id = new.id and r.status = 'pending';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sesiones_close_requests on public.quotation_sessions;
create trigger trg_sesiones_close_requests
  after update of status on public.quotation_sessions
  for each row execute function public.sesiones_close_requests();

-- 7) Turnos reservados online: el cliente ya pidió ese horario → confirmada.
create or replace function public.sesiones_hold_confirms_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(pg_catalog.current_setting('weotzi.sesiones_bypass', true), '');
begin
  if new.status = 'confirmed' and new.session_id is not null then
    perform pg_catalog.set_config('weotzi.sesiones_bypass', '1', true);
    update public.quotation_sessions s
       set client_confirmation = 'confirmed',
           client_confirmed_at = coalesce(s.client_confirmed_at, pg_catalog.now())
     where s.id = new.session_id
       and s.client_confirmation is distinct from 'confirmed';
    perform pg_catalog.set_config('weotzi.sesiones_bypass', v_prev, true);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sesiones_hold_confirms_session on public.artist_booking_holds;
create trigger trg_sesiones_hold_confirms_session
  after insert or update of status, session_id on public.artist_booking_holds
  for each row execute function public.sesiones_hold_confirms_session();

-- 8) Google Calendar: "por confirmar" va en el título → resincronizar al confirmar.
do $$
begin
  if to_regprocedure('private.gcal_mark_dirty()') is not null then
    drop trigger if exists trg_gcal_dirty_confirmacion on public.quotation_sessions;
    create trigger trg_gcal_dirty_confirmacion
      after update of client_confirmation on public.quotation_sessions
      for each row execute function private.gcal_mark_dirty('quotation_id', 'quotation');
  end if;
end $$;

-- 6) RPC (service-role) ---------------------------------------------------------------
-- p_actor es el usuario que el servidor ya autenticó. Errores: mensaje = token.

-- El cliente confirma la sesión propuesta.
create or replace function public.sesiones_confirm(p_session uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.quotation_sessions;
  v_client uuid;
begin
  select * into v_s from public.quotation_sessions s where s.id = p_session for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select q.client_user_id into v_client from public.quotations_db q where q.id = v_s.quotation_id;
  if p_actor is null or v_client is null or v_client <> p_actor then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_s.status not in ('scheduled', 'rescheduled') then
    raise exception 'SESSION_CLOSED' using errcode = '22023';
  end if;
  if v_s.session_date <= pg_catalog.now() then
    raise exception 'SESSION_PAST' using errcode = '22023';
  end if;
  if v_s.client_confirmation = 'confirmed' then
    return jsonb_build_object('already', true, 'session_id', v_s.id, 'client_confirmation', 'confirmed');
  end if;

  perform pg_catalog.set_config('weotzi.sesiones_bypass', '1', true);
  -- Si había pedido otra fecha y ahora confirma la original, su pedido se retira.
  update public.quotation_session_change_requests r
     set status = 'withdrawn', updated_at = pg_catalog.now()
   where r.session_id = v_s.id and r.status = 'pending' and r.requested_by_role = 'client';
  update public.quotation_sessions s
     set client_confirmation = 'confirmed', client_confirmed_at = pg_catalog.now()
   where s.id = v_s.id;
  perform pg_catalog.set_config('weotzi.sesiones_bypass', '', true);

  return jsonb_build_object('already', false, 'session_id', v_s.id, 'client_confirmation', 'confirmed');
end;
$$;

-- Cualquiera de las partes pide un cambio (fecha, duración o lugar).
create or replace function public.sesiones_request_change(
  p_session uuid,
  p_actor uuid,
  p_proposed_date timestamptz default null,
  p_duration_hours numeric default null,
  p_location text default null,
  p_location_kind text default null,
  p_location_ref uuid default null,
  p_location_place_id text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.quotation_sessions;
  v_client uuid;
  v_artist uuid;
  v_quote_status text;
  v_role text;
  v_pending public.quotation_session_change_requests;
  v_req public.quotation_session_change_requests;
  v_date timestamptz;
  v_duration numeric;
  v_location text;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_confirmation text;
begin
  select * into v_s from public.quotation_sessions s where s.id = p_session for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select q.client_user_id, q.artist_id, q.quote_status into v_client, v_artist, v_quote_status
    from public.quotations_db q where q.id = v_s.quotation_id;
  if p_actor is not null and v_client is not null and v_client = p_actor then
    v_role := 'client';
  elsif p_actor is not null and v_artist is not null and v_artist = p_actor then
    v_role := 'artist';
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_client is null then
    -- Sin cuenta de cliente no hay con quién acordar: el artista edita directo.
    raise exception 'DIRECT_EDIT' using errcode = '22023';
  end if;
  if v_quote_status in ('cancelled', 'expired', 'client_rejected', 'completed') then
    raise exception 'QUOTE_CLOSED' using errcode = '22023';
  end if;
  if v_s.status not in ('scheduled', 'rescheduled') then
    raise exception 'SESSION_CLOSED' using errcode = '22023';
  end if;
  if v_s.session_date <= pg_catalog.now() then
    raise exception 'SESSION_PAST' using errcode = '22023';
  end if;
  if v_s.client_confirmation = 'confirmed' then
    -- Regla del dueño: una sesión acordada se edita hasta 3 días antes.
    if v_s.session_date - pg_catalog.now() < interval '3 days' then
      raise exception 'EDIT_WINDOW_CLOSED' using errcode = '22023';
    end if;
  elsif v_role = 'artist' then
    -- Todavía no la confirmó el cliente: el artista la edita y se vuelve a proponer.
    raise exception 'DIRECT_EDIT' using errcode = '22023';
  end if;

  -- Solo cuenta lo que cambia respecto de lo guardado.
  v_date := case when p_proposed_date is not null and p_proposed_date is distinct from v_s.session_date
                 then p_proposed_date end;
  v_duration := case when p_duration_hours is not null
                      and p_duration_hours is distinct from coalesce(nullif(v_s.duration_hours, 0), 1)
                     then p_duration_hours end;
  v_location := nullif(pg_catalog.btrim(coalesce(p_location, '')), '');
  if v_location is not null and v_location = pg_catalog.btrim(coalesce(v_s.location, '')) then
    v_location := null;
  end if;
  if v_date is null and v_duration is null and v_location is null then
    raise exception 'INVALID_PROPOSAL' using errcode = '22023';
  end if;
  if v_date is not null and v_date <= pg_catalog.now() then
    raise exception 'INVALID_PROPOSAL' using errcode = '22023';
  end if;
  if v_duration is not null and (v_duration < 0.25 or v_duration > 24) then
    raise exception 'INVALID_PROPOSAL' using errcode = '22023';
  end if;
  if v_location is not null and char_length(v_location) > 300 then
    raise exception 'INVALID_PROPOSAL' using errcode = '22023';
  end if;
  if p_location_kind is not null and p_location_kind not in ('studio', 'own', 'client', 'custom') then
    raise exception 'INVALID_PROPOSAL' using errcode = '22023';
  end if;

  select * into v_pending from public.quotation_session_change_requests r
   where r.session_id = v_s.id and r.status = 'pending' for update;
  if found then
    if v_pending.requested_by_role <> v_role then
      raise exception 'REQUEST_PENDING' using errcode = '22023';
    end if;
    update public.quotation_session_change_requests r
       set status = 'superseded', updated_at = pg_catalog.now()
     where r.id = v_pending.id;
  end if;

  insert into public.quotation_session_change_requests (
    session_id, quotation_id, requested_by, requested_by_role, previous_date,
    proposed_date, proposed_duration_hours, proposed_location,
    proposed_location_kind, proposed_location_ref, proposed_location_place_id, note
  ) values (
    v_s.id, v_s.quotation_id, p_actor, v_role, v_s.session_date,
    v_date, v_duration, v_location,
    case when v_location is not null then coalesce(p_location_kind, 'custom') end,
    case when v_location is not null then p_location_ref end,
    case when v_location is not null then nullif(pg_catalog.left(coalesce(p_location_place_id, ''), 300), '') end,
    pg_catalog.left(v_note, 1000)
  )
  returning * into v_req;

  v_confirmation := v_s.client_confirmation;
  if v_s.client_confirmation = 'pending' then
    perform pg_catalog.set_config('weotzi.sesiones_bypass', '1', true);
    update public.quotation_sessions s set client_confirmation = 'change_requested' where s.id = v_s.id;
    perform pg_catalog.set_config('weotzi.sesiones_bypass', '', true);
    v_confirmation := 'change_requested';
  end if;

  return jsonb_build_object('request_id', v_req.id, 'session_id', v_s.id,
    'requested_by_role', v_role, 'client_confirmation', v_confirmation);
end;
$$;

-- La otra parte acepta o rechaza la solicitud.
create or replace function public.sesiones_respond_change(
  p_request uuid,
  p_actor uuid,
  p_accept boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quotation_session_change_requests;
  v_s public.quotation_sessions;
  v_client uuid;
  v_artist uuid;
  v_role text;
  v_new_date timestamptz;
  v_confirmation text;
begin
  select * into v_req from public.quotation_session_change_requests r where r.id = p_request for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_s from public.quotation_sessions s where s.id = v_req.session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select q.client_user_id, q.artist_id into v_client, v_artist
    from public.quotations_db q where q.id = v_s.quotation_id;
  if p_actor is not null and v_client is not null and v_client = p_actor then
    v_role := 'client';
  elsif p_actor is not null and v_artist is not null and v_artist = p_actor then
    v_role := 'artist';
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- Responde la OTRA parte, nunca quien lo pidió.
  if v_role = v_req.requested_by_role then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_CLOSED' using errcode = '22023';
  end if;
  if v_s.status not in ('scheduled', 'rescheduled') then
    raise exception 'SESSION_CLOSED' using errcode = '22023';
  end if;
  if v_s.session_date <= pg_catalog.now() then
    raise exception 'SESSION_PAST' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('weotzi.sesiones_bypass', '1', true);
  if coalesce(p_accept, false) then
    v_new_date := coalesce(v_req.proposed_date, v_s.session_date);
    if v_req.proposed_date is not null and v_req.proposed_date <= pg_catalog.now() then
      raise exception 'PROPOSAL_EXPIRED' using errcode = '22023';
    end if;
    -- El trigger de superposición puede rechazar el horario (23P01).
    update public.quotation_sessions s
       set session_date = v_new_date,
           duration_hours = coalesce(v_req.proposed_duration_hours, s.duration_hours),
           location = coalesce(v_req.proposed_location, s.location),
           location_kind = case when v_req.proposed_location is not null then v_req.proposed_location_kind else s.location_kind end,
           location_ref = case when v_req.proposed_location is not null then v_req.proposed_location_ref else s.location_ref end,
           location_place_id = case when v_req.proposed_location is not null then v_req.proposed_location_place_id else s.location_place_id end,
           status = case when v_new_date is distinct from s.session_date then 'rescheduled' else s.status end,
           client_confirmation = 'confirmed',
           client_confirmed_at = pg_catalog.now()
     where s.id = v_s.id;
    update public.quotation_session_change_requests r
       set status = 'accepted', responded_by = p_actor, responded_at = pg_catalog.now(),
           response_note = pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), 1000),
           updated_at = pg_catalog.now()
     where r.id = v_req.id;
    v_confirmation := 'confirmed';
  else
    update public.quotation_session_change_requests r
       set status = 'rejected', responded_by = p_actor, responded_at = pg_catalog.now(),
           response_note = pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), 1000),
           updated_at = pg_catalog.now()
     where r.id = v_req.id;
    v_confirmation := v_s.client_confirmation;
    if v_s.client_confirmation = 'change_requested' then
      update public.quotation_sessions s set client_confirmation = 'pending' where s.id = v_s.id;
      v_confirmation := 'pending';
    end if;
  end if;
  perform pg_catalog.set_config('weotzi.sesiones_bypass', '', true);

  return jsonb_build_object('request_id', v_req.id, 'session_id', v_s.id,
    'accepted', coalesce(p_accept, false), 'responded_by_role', v_role,
    'requested_by_role', v_req.requested_by_role, 'client_confirmation', v_confirmation,
    'date_changed', (coalesce(p_accept, false) and (v_new_date is distinct from v_s.session_date)));
end;
$$;

-- Quien pidió el cambio lo retira.
create or replace function public.sesiones_withdraw_change(p_request uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quotation_session_change_requests;
  v_s public.quotation_sessions;
  v_confirmation text;
begin
  select * into v_req from public.quotation_session_change_requests r where r.id = p_request for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_actor is null or v_req.requested_by <> p_actor then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_CLOSED' using errcode = '22023';
  end if;
  select * into v_s from public.quotation_sessions s where s.id = v_req.session_id for update;

  update public.quotation_session_change_requests r
     set status = 'withdrawn', updated_at = pg_catalog.now()
   where r.id = v_req.id;
  v_confirmation := v_s.client_confirmation;
  if v_s.client_confirmation = 'change_requested' then
    perform pg_catalog.set_config('weotzi.sesiones_bypass', '1', true);
    update public.quotation_sessions s set client_confirmation = 'pending' where s.id = v_s.id;
    perform pg_catalog.set_config('weotzi.sesiones_bypass', '', true);
    v_confirmation := 'pending';
  end if;

  return jsonb_build_object('request_id', v_req.id, 'session_id', v_req.session_id,
    'requested_by_role', v_req.requested_by_role, 'client_confirmation', v_confirmation);
end;
$$;

-- Calificación + registro de una sesión pasada (una fila por parte, editable).
create or replace function public.sesiones_save_feedback(
  p_session uuid,
  p_actor uuid,
  p_rating integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.quotation_sessions;
  v_client uuid;
  v_artist uuid;
  v_role text;
  v_row public.quotation_session_feedback;
  v_created boolean;
begin
  select * into v_s from public.quotation_sessions s where s.id = p_session;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select q.client_user_id, q.artist_id into v_client, v_artist
    from public.quotations_db q where q.id = v_s.quotation_id;
  if p_actor is not null and v_client is not null and v_client = p_actor then
    v_role := 'client';
  elsif p_actor is not null and v_artist is not null and v_artist = p_actor then
    v_role := 'artist';
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_s.status = 'cancelled'
     or not (v_s.status in ('completed', 'no_show') or v_s.session_date <= pg_catalog.now()) then
    raise exception 'SESSION_NOT_PAST' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_FEEDBACK' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_FEEDBACK' using errcode = '22023';
  end if;

  insert into public.quotation_session_feedback as f (session_id, quotation_id, author_user_id, author_role, rating, note)
  values (v_s.id, v_s.quotation_id, p_actor, v_role, p_rating::smallint, nullif(pg_catalog.btrim(coalesce(p_note, '')), ''))
  on conflict on constraint quotation_session_feedback_one_per_role do update
     set rating = excluded.rating, note = excluded.note,
         author_user_id = excluded.author_user_id, updated_at = pg_catalog.now()
  returning f.* into v_row;
  v_created := v_row.created_at = v_row.updated_at;

  return jsonb_build_object('feedback_id', v_row.id, 'session_id', v_s.id,
    'author_role', v_role, 'rating', v_row.rating, 'created', v_created);
end;
$$;

-- Disputa sobre una sesión: ticket kind 'disputa' del centro de soporte
-- (mismas reglas que open_support_dispute, con la sesión vinculada).
create or replace function public.sesiones_open_dispute(
  p_session uuid,
  p_actor uuid,
  p_reason text,
  p_subject text,
  p_description text,
  p_desired_outcome text default 'mediacion'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.quotation_sessions;
  v_quotation_id integer;
  v_quote_id text;
  v_client uuid;
  v_artist uuid;
  v_quote_status text;
  v_role text;
  v_counterpart uuid;
  v_counterpart_role text;
  v_recent integer;
  v_ticket_id uuid;
  v_ticket_number bigint;
begin
  select * into v_s from public.quotation_sessions s where s.id = p_session;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select q.id, q.quote_id, q.client_user_id, q.artist_id, q.quote_status
    into v_quotation_id, v_quote_id, v_client, v_artist, v_quote_status
    from public.quotations_db q where q.id = v_s.quotation_id
    for update;
  if p_actor is not null and v_client is not null and v_client = p_actor then
    v_role := 'client';
    v_counterpart := v_artist;
    v_counterpart_role := case when v_artist is null then null else 'artist' end;
  elsif p_actor is not null and v_artist is not null and v_artist = p_actor then
    v_role := 'artist';
    v_counterpart := v_client;
    v_counterpart_role := case when v_client is null then null else 'client' end;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not public.support_disputable_quote_status(v_quote_status) then
    raise exception 'NOT_DISPUTABLE' using errcode = '22023';
  end if;
  if exists (select 1 from public.support_tickets t
              where t.quotation_id = v_quotation_id and t.kind = 'disputa'
                and t.status in ('open', 'in_progress', 'waiting_user')) then
    raise exception 'DISPUTE_ACTIVE' using errcode = '22023';
  end if;
  select count(*) into v_recent from public.support_tickets t
   where t.requester_user_id = p_actor and t.created_at > pg_catalog.now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'TICKET_LIMIT' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('cancelacion', 'no_presentacion', 'trato', 'higiene', 'calidad', 'pago', 'otro') then
    raise exception 'INVALID_DISPUTE' using errcode = '22023';
  end if;
  if p_desired_outcome is null or p_desired_outcome not in ('correccion', 'reembolso_parcial', 'reembolso_total', 'mediacion', 'otro') then
    raise exception 'INVALID_DISPUTE' using errcode = '22023';
  end if;
  if char_length(pg_catalog.btrim(coalesce(p_subject, ''))) not between 3 and 160
     or char_length(pg_catalog.btrim(coalesce(p_description, ''))) not between 10 and 6000 then
    raise exception 'INVALID_DISPUTE' using errcode = '22023';
  end if;

  insert into public.support_tickets (
    kind, category, priority, subject, description, requester_user_id, requester_role,
    counterpart_user_id, counterpart_role, quotation_id, quote_id,
    dispute_reason, desired_outcome, page_context
  ) values (
    'disputa', 'disputa',
    case when p_reason = 'higiene' then 'urgent' else 'high' end,
    pg_catalog.btrim(p_subject), pg_catalog.btrim(p_description), p_actor, v_role,
    v_counterpart, v_counterpart_role, v_quotation_id, v_quote_id,
    p_reason, p_desired_outcome, 'session:' || v_s.id::text
  )
  returning id, ticket_number into v_ticket_id, v_ticket_number;

  insert into public.support_ticket_messages (ticket_id, author_role, body)
  values (v_ticket_id, 'system',
    'Disputa abierta sobre una sesión. La otra parte puede ver el reclamo y responder en este hilo. Soporte revisa el caso y responde dentro de las próximas 48 horas hábiles.');

  insert into public.quotation_session_disputes (session_id, quotation_id, ticket_id, opened_by, opened_by_role, reason)
  values (v_s.id, v_quotation_id, v_ticket_id, p_actor, v_role, p_reason);

  return jsonb_build_object('ticket_id', v_ticket_id, 'ticket_number', v_ticket_number,
    'session_id', v_s.id, 'opened_by_role', v_role);
end;
$$;

-- Privilegios: funciones de trigger y RPC solo para el servidor.
revoke all on function public.sesiones_guard() from public, anon, authenticated;
revoke all on function public.sesiones_close_requests() from public, anon, authenticated;
revoke all on function public.sesiones_hold_confirms_session() from public, anon, authenticated;

revoke all on function public.sesiones_confirm(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sesiones_request_change(uuid, uuid, timestamptz, numeric, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.sesiones_respond_change(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.sesiones_withdraw_change(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sesiones_save_feedback(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.sesiones_open_dispute(uuid, uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.sesiones_confirm(uuid, uuid) to service_role;
grant execute on function public.sesiones_request_change(uuid, uuid, timestamptz, numeric, text, text, uuid, text, text) to service_role;
grant execute on function public.sesiones_respond_change(uuid, uuid, boolean, text) to service_role;
grant execute on function public.sesiones_withdraw_change(uuid, uuid) to service_role;
grant execute on function public.sesiones_save_feedback(uuid, uuid, integer, text) to service_role;
grant execute on function public.sesiones_open_dispute(uuid, uuid, text, text, text, text) to service_role;

commit;
