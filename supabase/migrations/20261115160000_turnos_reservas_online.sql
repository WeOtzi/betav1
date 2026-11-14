-- Turnos disponibles y reservas online (beta cerrada · frente "turnos").
--
-- Requisito: We Ötzi calcula los turnos libres del tatuador (horario semanal ×
-- eventos), el cliente elige uno desde el enlace público del artista, eso abre
-- /quotation con el turno precargado, el turno queda APARTADO mientras el
-- artista responde (72 h por defecto) y se BLOQUEA al aceptarlo (se crea la
-- sesión). Si vence, se rechaza o se cancela, se libera.
--
-- Decisiones del dueño: duración 180 min, paso 60 min, margen 30 min,
-- anticipación 24 h, horizonte 365 d, apartado 72 h; reservas online opt-in.
--
-- Contenido (aditivo e idempotente):
--   1) artist_booking_settings  · reglas de turno por artista (+ opt-in).
--   2) artist_booking_holds     · apartados y turnos confirmados.
--   3) quotations_db.requested_slot_start / requested_slot_minutes.
--   4) private.artist_blocking_intervals + wrapper service-role.
--   5) save_web_quotation_with_slot (alta atómica con apartado, control de
--      concurrencia por advisory lock del artista).
--   6) confirm / release / expire de apartados (service-role; el servidor
--      valida al actor y manda los emails).
--   7) Superposición: trigger en quotation_sessions, prevent_artist_calendar_overlap
--      y check_artist_calendar_conflicts ven sesiones, citas de estudio,
--      viajes, vacaciones y apartados (CAL-08 / CAL-16).
--   8) Liberación de apartados al cancelar/vencer/rechazar la cotización y al
--      cancelar la sesión del turno.
--   9) list_artist_public_busy_days respeta el horario semanal, las ubicaciones
--      pausadas y las citas de estudio (CAL-09).
--
-- Reversa: supabase/rollbacks/20261115160000_turnos_reservas_online.down.sql

begin;

-- 1) Reglas de turno -------------------------------------------------------------
create table if not exists public.artist_booking_settings (
  artist_user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  slot_minutes integer not null default 180,
  slot_step_minutes integer not null default 60,
  buffer_minutes integer not null default 30,
  min_notice_hours integer not null default 24,
  horizon_days integer not null default 365,
  hold_hours integer not null default 72,
  public_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_booking_settings_slot_minutes_check check (slot_minutes between 30 and 720),
  constraint artist_booking_settings_step_check check (slot_step_minutes in (15, 30, 60, 90, 120, 180, 240)),
  constraint artist_booking_settings_buffer_check check (buffer_minutes between 0 and 240),
  constraint artist_booking_settings_notice_check check (min_notice_hours between 0 and 720),
  constraint artist_booking_settings_horizon_check check (horizon_days between 7 and 400),
  constraint artist_booking_settings_hold_check check (hold_hours between 1 and 336),
  constraint artist_booking_settings_note_check check (public_note is null or char_length(public_note) <= 280)
);

alter table public.artist_booking_settings enable row level security;

drop policy if exists artist_booking_settings_owner_select on public.artist_booking_settings;
create policy artist_booking_settings_owner_select on public.artist_booking_settings
  for select to authenticated using (artist_user_id = (select auth.uid()));
drop policy if exists artist_booking_settings_owner_insert on public.artist_booking_settings;
create policy artist_booking_settings_owner_insert on public.artist_booking_settings
  for insert to authenticated with check (artist_user_id = (select auth.uid()));
drop policy if exists artist_booking_settings_owner_update on public.artist_booking_settings;
create policy artist_booking_settings_owner_update on public.artist_booking_settings
  for update to authenticated using (artist_user_id = (select auth.uid()))
  with check (artist_user_id = (select auth.uid()));

revoke all on table public.artist_booking_settings from anon;
revoke delete, truncate, references, trigger on table public.artist_booking_settings from authenticated;
grant select, insert, update on table public.artist_booking_settings to authenticated;
grant all on table public.artist_booking_settings to service_role;

drop trigger if exists trg_artist_booking_settings_updated_at on public.artist_booking_settings;
create trigger trg_artist_booking_settings_updated_at
  before update on public.artist_booking_settings
  for each row execute function public.set_updated_at();

-- 2) Apartados y turnos confirmados --------------------------------------------
create table if not exists public.artist_booking_holds (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users(id) on delete cascade,
  quotation_id integer not null references public.quotations_db(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending',
  expires_at timestamptz,
  session_id uuid references public.quotation_sessions(id) on delete set null,
  released_reason text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_booking_holds_range_check check (ends_at > starts_at),
  constraint artist_booking_holds_status_check check (status in ('pending', 'confirmed', 'released', 'expired')),
  constraint artist_booking_holds_reason_check check (released_reason is null or char_length(released_reason) <= 60)
);

create index if not exists artist_booking_holds_artist_active_idx
  on public.artist_booking_holds (artist_user_id, starts_at)
  where status in ('pending', 'confirmed');
create unique index if not exists artist_booking_holds_one_active_per_quote
  on public.artist_booking_holds (quotation_id)
  where status in ('pending', 'confirmed');
create index if not exists artist_booking_holds_expiry_idx
  on public.artist_booking_holds (expires_at)
  where status = 'pending';
create index if not exists artist_booking_holds_session_idx
  on public.artist_booking_holds (session_id)
  where session_id is not null;

alter table public.artist_booking_holds enable row level security;

drop policy if exists artist_booking_holds_artist_select on public.artist_booking_holds;
create policy artist_booking_holds_artist_select on public.artist_booking_holds
  for select to authenticated using (artist_user_id = (select auth.uid()));
drop policy if exists artist_booking_holds_client_select on public.artist_booking_holds;
create policy artist_booking_holds_client_select on public.artist_booking_holds
  for select to authenticated using (exists (
    select 1 from public.quotations_db q
    where q.id = artist_booking_holds.quotation_id and q.client_user_id = (select auth.uid())
  ));

-- Sin escrituras directas: todo pasa por las funciones de abajo.
revoke all on table public.artist_booking_holds from anon, authenticated;
grant select on table public.artist_booking_holds to authenticated;
grant all on table public.artist_booking_holds to service_role;

drop trigger if exists trg_artist_booking_holds_updated_at on public.artist_booking_holds;
create trigger trg_artist_booking_holds_updated_at
  before update on public.artist_booking_holds
  for each row execute function public.set_updated_at();

-- 3) Turno pedido en la cotización ------------------------------------------------
alter table public.quotations_db add column if not exists requested_slot_start timestamptz;
alter table public.quotations_db add column if not exists requested_slot_minutes integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotations_db_requested_slot_minutes_check') then
    alter table public.quotations_db add constraint quotations_db_requested_slot_minutes_check
      check (requested_slot_minutes is null or requested_slot_minutes between 15 and 1440);
  end if;
end $$;

-- 4) Intervalos que ocupan la agenda del artista ---------------------------------
-- kind: event | session | studio_booking (duros) · trip | vacation | hold (blandos).
-- p_exclude_quotation deja afuera lo de esa cotización (su apartado, sus
-- sesiones y su reserva manual vinculada): no chocan entre sí.
create or replace function private.artist_blocking_intervals(
  p_artist uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_quotation integer default null,
  p_exclude_session uuid default null,
  p_exclude_event uuid default null,
  p_include_soft boolean default true
)
returns table (starts_at timestamptz, ends_at timestamptz, kind text, ref_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select o.occ_start, o.occ_end, 'event'::text, e.id
  from public.artist_calendar_events e
  cross join lateral (
    select e.starts_at + (g.n * interval '7 days') as occ_start,
           e.ends_at + (g.n * interval '7 days') as occ_end
    from pg_catalog.generate_series(
      0,
      case when e.recurrence_rule = 'weekly' then least(
        103,
        greatest(0, floor(extract(epoch from (
          coalesce(e.recurrence_until::timestamptz + interval '1 day', e.starts_at + interval '2 years') - e.starts_at
        )) / 604800)::integer)
      ) else 0 end
    ) as g(n)
  ) o
  where e.artist_user_id = p_artist
    and e.status <> 'cancelled'
    and e.event_type in ('confirmed_session', 'reservation', 'blocked_day', 'guest_spot', 'convention', 'personal')
    and (p_exclude_event is null or e.id <> p_exclude_event)
    and (p_exclude_quotation is null or e.quotation_id is distinct from p_exclude_quotation)
    and e.starts_at < p_to
    and o.occ_start < p_to
    and o.occ_end > p_from
  union all
  select qs.session_date,
         qs.session_date + coalesce(nullif(qs.duration_hours, 0), 1)::double precision * interval '1 hour',
         'session'::text,
         qs.id
  from public.quotation_sessions qs
  join public.quotations_db q on q.id = qs.quotation_id
  where q.artist_id = p_artist
    and qs.status <> 'cancelled'
    and coalesce(q.quote_status, '') not in ('cancelled', 'expired', 'client_rejected')
    and (p_exclude_quotation is null or qs.quotation_id <> p_exclude_quotation)
    and (p_exclude_session is null or qs.id <> p_exclude_session)
    and qs.session_date < p_to
    and qs.session_date + coalesce(nullif(qs.duration_hours, 0), 1)::double precision * interval '1 hour' > p_from
  union all
  select b.starts_at, b.ends_at, 'studio_booking'::text, b.id
  from public.studio_bookings b
  where b.artist_user_id = p_artist
    and b.status = 'confirmed'
    and b.starts_at < p_to
    and b.ends_at > p_from
  union all
  select (t.start_date::timestamp at time zone private.wo_artist_timezone(p_artist)),
         ((t.end_date + 1)::timestamp at time zone private.wo_artist_timezone(p_artist)),
         'trip'::text,
         t.id
  from public.artist_trips t
  where p_include_soft
    and t.artist_user_id = p_artist
    and t.status = 'confirmado'
    and t.cancelled_at is null
    and (t.start_date::timestamp at time zone private.wo_artist_timezone(p_artist)) < p_to
    and ((t.end_date + 1)::timestamp at time zone private.wo_artist_timezone(p_artist)) > p_from
  union all
  select (a.vacation_start::timestamp at time zone private.wo_artist_timezone(p_artist)),
         ((a.vacation_end + 1)::timestamp at time zone private.wo_artist_timezone(p_artist)),
         'vacation'::text,
         null::uuid
  from public.artists_db a
  where p_include_soft
    and a.user_id = p_artist
    and a.vacation_start is not null
    and a.vacation_end is not null
    and a.vacation_end >= a.vacation_start
    and (a.vacation_start::timestamp at time zone private.wo_artist_timezone(p_artist)) < p_to
    and ((a.vacation_end + 1)::timestamp at time zone private.wo_artist_timezone(p_artist)) > p_from
  union all
  select h.starts_at, h.ends_at, 'hold'::text, h.id
  from public.artist_booking_holds h
  where p_include_soft
    and h.artist_user_id = p_artist
    and h.status = 'pending'
    and h.expires_at > pg_catalog.now()
    and (p_exclude_quotation is null or h.quotation_id <> p_exclude_quotation)
    and h.starts_at < p_to
    and h.ends_at > p_from;
$$;

revoke all on function private.artist_blocking_intervals(uuid, timestamptz, timestamptz, integer, uuid, uuid, boolean) from public, anon, authenticated;

-- Wrapper para el servidor (service_role): solo inicio, fin y tipo, sin ids.
create or replace function public.list_artist_blocking_intervals(
  p_artist uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.starts_at, b.ends_at, b.kind
  from private.artist_blocking_intervals(p_artist, p_from, p_to, null, null, null, true) b
  order by b.starts_at;
$$;

revoke all on function public.list_artist_blocking_intervals(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.list_artist_blocking_intervals(uuid, timestamptz, timestamptz) to service_role;

-- 5) Alta de la cotización con apartado del turno --------------------------------
-- La llama SOLO el servidor (services/quotation-intake.js) en el envío final,
-- después de validar que el turno está ofrecido (lib/booking-slots.js). Acá se
-- serializa por artista y se re-chequea contra lo que puede cambiar en paralelo
-- (eventos, sesiones, citas de estudio y otros apartados). Si choca, la
-- cotización queda como borrador ('in_progress') y responde slot_status 'taken'.
create or replace function public.save_web_quotation_with_slot(
  p_quote jsonb,
  p_extras jsonb,
  p_slot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_start timestamptz;
  v_minutes integer;
  v_end timestamptz;
  v_settings public.artist_booking_settings;
  v_existing_id integer;
  v_existing_status text;
  v_hold public.artist_booking_holds;
  v_saved jsonb;
  v_quote public.quotations_db;
  v_buffer interval;
begin
  if coalesce(p_quote ->> 'quote_status', '') <> 'pending' then
    raise exception 'Invalid slot intake' using errcode = '22023';
  end if;
  begin
    v_artist := nullif(p_quote ->> 'artist_id', '')::uuid;
    v_start := (p_slot ->> 'start')::timestamptz;
    v_minutes := (p_slot ->> 'minutes')::integer;
  exception when others then
    raise exception 'Invalid slot' using errcode = '22023';
  end;
  if v_artist is null or v_start is null or v_minutes is null or v_minutes not between 15 and 1440 then
    raise exception 'Invalid slot' using errcode = '22023';
  end if;
  v_end := v_start + make_interval(mins => v_minutes);

  select * into v_settings from public.artist_booking_settings s where s.artist_user_id = v_artist;
  if not found or not v_settings.enabled then
    return jsonb_build_object('slot_status', 'disabled');
  end if;
  if v_start < pg_catalog.now() or v_start > pg_catalog.now() + make_interval(days => v_settings.horizon_days) then
    return jsonb_build_object('slot_status', 'taken');
  end if;
  v_buffer := make_interval(mins => v_settings.buffer_minutes);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_artist::text, 0));

  select q.id, q.quote_status into v_existing_id, v_existing_status
  from public.quotations_db q where q.quote_id = p_quote ->> 'quote_id';

  -- Reintento del mismo envío: devuelve el apartado que ya existe.
  if v_existing_id is not null and v_existing_status <> 'in_progress' then
    select * into v_hold from public.artist_booking_holds h
    where h.quotation_id = v_existing_id and h.status in ('pending', 'confirmed')
    limit 1;
    return jsonb_build_object(
      'quote_id', p_quote ->> 'quote_id', 'id', v_existing_id, 'status', v_existing_status,
      'slot_status', case when v_hold.id is null then 'none' else 'held' end,
      'hold_id', v_hold.id, 'expires_at', v_hold.expires_at
    );
  end if;

  if exists (
    select 1
    from private.artist_blocking_intervals(v_artist, v_start - v_buffer, v_end + v_buffer, v_existing_id, null, null, true) b
    where b.kind in ('event', 'session', 'studio_booking', 'hold')
  ) then
    v_saved := public.save_web_quotation(jsonb_set(p_quote, '{quote_status}', '"in_progress"'), p_extras);
    return v_saved || jsonb_build_object('slot_status', 'taken');
  end if;

  v_saved := public.save_web_quotation(p_quote, p_extras);
  select * into v_quote from public.quotations_db q where q.quote_id = v_saved ->> 'quote_id';
  if v_quote.id is null or v_quote.quote_status <> 'pending' then
    return v_saved || jsonb_build_object('slot_status', 'none');
  end if;

  update public.quotations_db
     set requested_slot_start = v_start, requested_slot_minutes = v_minutes
   where id = v_quote.id;

  -- Un borrador reabierto puede arrastrar un apartado anterior: se reemplaza
  -- (índice único: un apartado activo por cotización). Si ya hay un turno
  -- confirmado, se respeta y no se aparta otro.
  if exists (select 1 from public.artist_booking_holds h
             where h.quotation_id = v_quote.id and h.status = 'confirmed') then
    return v_saved || jsonb_build_object('id', v_quote.id, 'slot_status', 'none');
  end if;
  update public.artist_booking_holds
     set status = 'released', released_reason = 'resubmitted'
   where quotation_id = v_quote.id and status = 'pending';

  insert into public.artist_booking_holds (artist_user_id, quotation_id, starts_at, ends_at, status, expires_at)
  values (v_artist, v_quote.id, v_start, v_end, 'pending', pg_catalog.now() + make_interval(hours => v_settings.hold_hours))
  returning * into v_hold;

  return v_saved || jsonb_build_object(
    'id', v_quote.id, 'slot_status', 'held', 'hold_id', v_hold.id, 'expires_at', v_hold.expires_at
  );
end;
$$;

revoke all on function public.save_web_quotation_with_slot(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_web_quotation_with_slot(jsonb, jsonb, jsonb) to service_role;

-- 6) Confirmar / liberar / vencer apartados ------------------------------------
-- Confirmar = el artista acepta el turno: se crea la sesión y el turno queda
-- bloqueado. p_starts / p_minutes permiten moverlo. Choque → 23P01 SLOT_TAKEN.
create or replace function public.confirm_artist_slot_hold(
  p_hold uuid,
  p_actor uuid,
  p_starts timestamptz default null,
  p_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.artist_booking_holds;
  v_quote public.quotations_db;
  v_start timestamptz;
  v_minutes integer;
  v_end timestamptz;
  v_session public.quotation_sessions;
begin
  select * into v_hold from public.artist_booking_holds h where h.id = p_hold for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_actor is null or v_hold.artist_user_id <> p_actor then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_hold.status = 'confirmed' and v_hold.session_id is not null then
    select * into v_session from public.quotation_sessions s where s.id = v_hold.session_id;
    return jsonb_build_object('status', 'confirmed', 'already', true, 'session_id', v_hold.session_id,
      'session_number', v_session.session_number, 'starts_at', v_hold.starts_at, 'ends_at', v_hold.ends_at);
  end if;
  if v_hold.status = 'released' then
    raise exception 'HOLD_RELEASED' using errcode = '22023';
  end if;

  select * into v_quote from public.quotations_db q where q.id = v_hold.quotation_id;
  if v_quote.id is null or v_quote.quote_status in ('cancelled', 'expired', 'client_rejected', 'completed') then
    raise exception 'QUOTE_CLOSED' using errcode = '22023';
  end if;

  v_start := coalesce(p_starts, v_hold.starts_at);
  v_minutes := coalesce(p_minutes, (extract(epoch from (v_hold.ends_at - v_hold.starts_at)) / 60)::integer);
  if v_minutes not between 15 and 1440 then
    raise exception 'Invalid slot' using errcode = '22023';
  end if;
  v_end := v_start + make_interval(mins => v_minutes);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hold.artist_user_id::text, 0));

  if exists (
    select 1
    from private.artist_blocking_intervals(v_hold.artist_user_id, v_start, v_end, v_hold.quotation_id, null, null, true) b
    where b.kind in ('event', 'session', 'studio_booking', 'hold')
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_TAKEN',
      detail = 'Ese horario ya está ocupado por otro turno, evento o cita.';
  end if;

  insert into public.quotation_sessions (quotation_id, session_date, duration_hours, status, notes)
  values (v_hold.quotation_id, v_start, round(v_minutes / 60.0, 2), 'scheduled', 'Turno reservado online')
  returning * into v_session;

  update public.artist_booking_holds
     set status = 'confirmed', session_id = v_session.id, starts_at = v_start, ends_at = v_end,
         confirmed_at = pg_catalog.now(), released_reason = null
   where id = v_hold.id;

  return jsonb_build_object('status', 'confirmed', 'already', false, 'session_id', v_session.id,
    'session_number', v_session.session_number, 'starts_at', v_start, 'ends_at', v_end);
end;
$$;

revoke all on function public.confirm_artist_slot_hold(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.confirm_artist_slot_hold(uuid, uuid, timestamptz, integer) to service_role;

-- Liberar: el artista o el cliente de la cotización (apartados no confirmados).
create or replace function public.release_artist_slot_hold(
  p_hold uuid,
  p_actor uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.artist_booking_holds;
  v_client uuid;
begin
  select * into v_hold from public.artist_booking_holds h where h.id = p_hold for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0002';
  end if;
  select q.client_user_id into v_client from public.quotations_db q where q.id = v_hold.quotation_id;
  if p_actor is null or (p_actor <> v_hold.artist_user_id and p_actor is distinct from v_client) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_hold.status = 'confirmed' then
    raise exception 'HOLD_CONFIRMED' using errcode = '22023';
  end if;
  if v_hold.status in ('pending', 'expired') then
    update public.artist_booking_holds
       set status = 'released',
           released_reason = left(coalesce(nullif(btrim(p_reason), ''),
             case when p_actor = v_hold.artist_user_id then 'artist' else 'client' end), 60)
     where id = v_hold.id;
  end if;
  return jsonb_build_object('status', 'released', 'hold_id', v_hold.id);
end;
$$;

revoke all on function public.release_artist_slot_hold(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_artist_slot_hold(uuid, uuid, text) to service_role;

-- Vencer apartados sin respuesta. Devuelve lo necesario para avisar al cliente
-- (lo llama el job del servidor cada 15 min; ver lib/booking-holds-job.js).
create or replace function public.expire_artist_slot_holds(p_limit integer default 200)
returns table (
  hold_id uuid,
  quotation_id integer,
  quote_id text,
  client_email text,
  client_full_name text,
  artist_user_id uuid,
  artist_name text,
  artist_username text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select h.id
    from public.artist_booking_holds h
    where h.status = 'pending' and h.expires_at <= pg_catalog.now()
    order by h.expires_at
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update skip locked
  ), done as (
    update public.artist_booking_holds h
       set status = 'expired', released_reason = 'hold_expired'
      from due
     where h.id = due.id
    returning h.id, h.quotation_id, h.artist_user_id, h.starts_at, h.ends_at
  )
  select d.id, d.quotation_id, q.quote_id::text, q.client_email::text, q.client_full_name::text,
         d.artist_user_id, a.name, a.username, d.starts_at, d.ends_at,
         private.wo_artist_timezone(d.artist_user_id)
  from done d
  join public.quotations_db q on q.id = d.quotation_id
  left join public.artists_db a on a.user_id = d.artist_user_id;
end;
$$;

revoke all on function public.expire_artist_slot_holds(integer) from public, anon, authenticated;
grant execute on function public.expire_artist_slot_holds(integer) to service_role;

-- 7) Superposición ------------------------------------------------------------------
-- 7a) Sesiones de cotización: no pueden pisar eventos que bloquean, otras
--     sesiones ni citas de estudio (los viajes y apartados solo avisan).
create or replace function public.prevent_quotation_session_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_end timestamptz;
begin
  -- Una sesión cancelada, realizada o ausente no reserva agenda: marcarla hecha
  -- antes de su hora (session_date = now()) no puede chocar (RLS-SESS-OVERLAP-04).
  if new.status in ('cancelled', 'completed', 'no_show') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.session_date is not distinct from old.session_date
     and new.duration_hours is not distinct from old.duration_hours
     and old.status not in ('cancelled', 'completed', 'no_show') then
    return new;
  end if;
  v_end := new.session_date + coalesce(nullif(new.duration_hours, 0), 1)::double precision * interval '1 hour';
  -- Registrar una sesión que ya pasó no compite por la agenda.
  if v_end <= pg_catalog.now() then
    return new;
  end if;
  select q.artist_id into v_artist from public.quotations_db q where q.id = new.quotation_id;
  if v_artist is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_artist::text, 0));

  if exists (
    select 1
    from private.artist_blocking_intervals(v_artist, new.session_date, v_end, new.quotation_id, new.id, null, false) b
  ) then
    raise exception using
      errcode = '23P01',
      message = 'CALENDAR_OVERLAP',
      detail = 'La sesión se superpone con otro turno, evento o cita que bloquea ese horario.',
      hint = 'Elegí otro horario o mové el evento existente.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_quotation_session_overlap on public.quotation_sessions;
create trigger trg_prevent_quotation_session_overlap
  before insert or update of session_date, duration_hours, status on public.quotation_sessions
  for each row execute function public.prevent_quotation_session_overlap();

-- 7b) Si se cancela la sesión del turno, el turno se libera.
create or replace function public.release_hold_on_session_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.artist_booking_holds
       set status = 'released', released_reason = 'session_cancelled'
     where session_id = new.id and status = 'confirmed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_hold_on_session_cancel on public.quotation_sessions;
create trigger trg_release_hold_on_session_cancel
  after update of status on public.quotation_sessions
  for each row execute function public.release_hold_on_session_cancel();

-- 7c) Eventos manuales: además de otros eventos, tampoco pisan sesiones ni
--     citas de estudio (CAL-16). Mismo advisory lock por artista.
create or replace function public.prevent_artist_calendar_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first timestamptz;
  v_last timestamptz;
begin
  if new.status = 'cancelled'
     or new.event_type in ('availability', 'reminder', 'pending_request') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.artist_user_id::text, 0)
  );

  if exists (
    with incoming as (
      select
        new.starts_at + (n * interval '7 days') as occurrence_start,
        new.ends_at + (n * interval '7 days') as occurrence_end
      from generate_series(
        0,
        case
          when new.recurrence_rule = 'weekly' then least(
            103,
            greatest(
              0,
              floor(extract(epoch from (
                coalesce(
                  new.recurrence_until::timestamptz + interval '1 day',
                  new.starts_at + interval '2 years'
                ) - new.starts_at
              )) / 604800)::integer
            )
          )
          else 0
        end
      ) as n
    ), existing as (
      select
        e.starts_at + (n * interval '7 days') as occurrence_start,
        e.ends_at + (n * interval '7 days') as occurrence_end
      from public.artist_calendar_events e
      cross join lateral generate_series(
        0,
        case
          when e.recurrence_rule = 'weekly' then least(
            103,
            greatest(
              0,
              floor(extract(epoch from (
                coalesce(
                  e.recurrence_until::timestamptz + interval '1 day',
                  e.starts_at + interval '2 years'
                ) - e.starts_at
              )) / 604800)::integer
            )
          )
          else 0
        end
      ) as n
      where e.artist_user_id = new.artist_user_id
        and e.status <> 'cancelled'
        and e.event_type in (
          'confirmed_session', 'reservation', 'blocked_day',
          'guest_spot', 'convention', 'personal'
        )
        and e.id <> new.id
    )
    select 1
    from incoming i
    join existing e
      on tstzrange(e.occurrence_start, e.occurrence_end, '[)')
         && tstzrange(i.occurrence_start, i.occurrence_end, '[)')
  ) then
    raise exception using
      errcode = '23P01',
      message = 'CALENDAR_OVERLAP',
      detail = 'El evento se superpone con otro evento que bloquea ese horario.',
      hint = 'Elegir otro horario o editar el evento existente.';
  end if;

  -- Sesiones con clientes y citas de estudio (no las de la misma cotización).
  v_first := new.starts_at;
  v_last := case
    when new.recurrence_rule = 'weekly'
      then least(coalesce(new.recurrence_until::timestamptz + interval '1 day', new.starts_at + interval '2 years'),
                 new.starts_at + interval '104 weeks') + (new.ends_at - new.starts_at)
    else new.ends_at
  end;
  if v_last > pg_catalog.now() and exists (
    with incoming as (
      select
        new.starts_at + (n * interval '7 days') as occurrence_start,
        new.ends_at + (n * interval '7 days') as occurrence_end
      from generate_series(
        0,
        case
          when new.recurrence_rule = 'weekly' then least(
            103,
            greatest(0, floor(extract(epoch from (
              coalesce(new.recurrence_until::timestamptz + interval '1 day', new.starts_at + interval '2 years') - new.starts_at
            )) / 604800)::integer)
          )
          else 0
        end
      ) as n
    )
    select 1
    from incoming i
    join private.artist_blocking_intervals(new.artist_user_id, v_first, v_last, new.quotation_id, null, new.id, false) b
      on b.kind in ('session', 'studio_booking')
     and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(i.occurrence_start, i.occurrence_end, '[)')
    where i.occurrence_end > pg_catalog.now()
  ) then
    raise exception using
      errcode = '23P01',
      message = 'CALENDAR_OVERLAP',
      detail = 'El evento se superpone con una sesión con un cliente o una cita de estudio.',
      hint = 'Elegir otro horario o reprogramar la sesión.';
  end if;

  return new;
end;
$$;

-- 7d) Aviso de conflictos en el editor del calendario: suma sesiones, citas de
--     estudio, viajes, vacaciones y solicitudes de turno, con títulos genéricos
--     (sin datos del cliente).
create or replace function public.check_artist_calendar_conflicts(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_recurrence_rule text default 'none',
  p_recurrence_until date default null,
  p_exclude_event_id uuid default null
)
returns table (id uuid, title text, starts_at timestamptz, ends_at timestamptz, event_type text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
  ), incoming as (
    select
      p_starts_at + (n * interval '7 days') as occurrence_start,
      p_ends_at + (n * interval '7 days') as occurrence_end
    from generate_series(
      0,
      case
        when p_recurrence_rule = 'weekly' then least(
          103,
          greatest(
            0,
            floor(extract(epoch from (
              coalesce(
                p_recurrence_until::timestamptz + interval '1 day',
                p_starts_at + interval '2 years'
              ) - p_starts_at
            )) / 604800)::integer
          )
        )
        else 0
      end
    ) as n
  ), existing as (
    select
      e.id,
      e.title,
      e.event_type,
      e.starts_at + (n * interval '7 days') as occurrence_start,
      e.ends_at + (n * interval '7 days') as occurrence_end
    from public.artist_calendar_events e
    cross join lateral generate_series(
      0,
      case
        when e.recurrence_rule = 'weekly' then least(
          103,
          greatest(
            0,
            floor(extract(epoch from (
              coalesce(
                e.recurrence_until::timestamptz + interval '1 day',
                e.starts_at + interval '2 years'
              ) - e.starts_at
            )) / 604800)::integer
          )
        )
        else 0
      end
    ) as n
    where e.artist_user_id = (select uid from me)
      and e.status <> 'cancelled'
      and e.event_type in (
        'confirmed_session', 'reservation', 'blocked_day',
        'guest_spot', 'convention', 'personal'
      )
      and (p_exclude_event_id is null or e.id <> p_exclude_event_id)
  ), manual as (
    select distinct on (e.id)
      e.id,
      e.title,
      e.occurrence_start as starts_at,
      e.occurrence_end as ends_at,
      e.event_type
    from existing e
    join incoming i
      on tstzrange(e.occurrence_start, e.occurrence_end, '[)')
         && tstzrange(i.occurrence_start, i.occurrence_end, '[)')
    order by e.id, e.occurrence_start
  ), other as (
    select distinct on (b.kind, b.ref_id, b.starts_at)
      b.ref_id as id,
      case b.kind
        when 'session' then 'Sesión con cliente'
        when 'studio_booking' then 'Cita de estudio'
        when 'trip' then 'Viaje confirmado'
        when 'vacation' then 'Vacaciones'
        else 'Solicitud de turno'
      end as title,
      b.starts_at,
      b.ends_at,
      case b.kind
        when 'session' then 'quotation_session'
        when 'studio_booking' then 'studio_booking'
        when 'trip' then 'trip'
        when 'vacation' then 'vacation'
        else 'booking_hold'
      end as event_type
    from me
    cross join lateral private.artist_blocking_intervals(
      me.uid,
      (select min(i.occurrence_start) from incoming i),
      (select max(i.occurrence_end) from incoming i),
      null, null, p_exclude_event_id, true
    ) b
    join incoming i
      on tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(i.occurrence_start, i.occurrence_end, '[)')
    where me.uid is not null
      and b.kind <> 'event'
    order by b.kind, b.ref_id, b.starts_at
  )
  select m.id, m.title, m.starts_at, m.ends_at, m.event_type from manual m
  union all
  select o.id, o.title, o.starts_at, o.ends_at, o.event_type from other o;
$$;

revoke all on function public.check_artist_calendar_conflicts(timestamptz, timestamptz, text, date, uuid) from public, anon;
grant execute on function public.check_artist_calendar_conflicts(timestamptz, timestamptz, text, date, uuid) to authenticated, service_role;

-- 8) La cotización se cierra → se libera el turno -------------------------------
create or replace function public.release_holds_on_quote_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quote_status is not distinct from old.quote_status
     or new.quote_status not in ('cancelled', 'expired', 'client_rejected') then
    return new;
  end if;
  update public.artist_booking_holds
     set status = 'released', released_reason = 'quote_' || new.quote_status
   where quotation_id = new.id and status in ('pending', 'expired');
  -- El turno confirmado se libera cancelando su sesión futura (el trigger de
  -- quotation_sessions marca el apartado como liberado). Mismo criterio que
  -- CAL-12 (private.quotation_closed_cancel_sessions, 20261115150000), que
  -- normalmente corre antes por orden alfabético; este bloque es el respaldo
  -- si gcal se revierte (RLS-TRG-DUP-02).
  update public.quotation_sessions s
     set status = 'cancelled'
    from public.artist_booking_holds h
   where h.quotation_id = new.id
     and h.status = 'confirmed'
     and h.session_id = s.id
     and s.status in ('scheduled', 'rescheduled')
     and s.session_date >= pg_catalog.now();
  update public.artist_booking_holds
     set status = 'released', released_reason = 'quote_' || new.quote_status
   where quotation_id = new.id and status = 'confirmed' and session_id is null;
  return new;
end;
$$;

drop trigger if exists trg_release_holds_on_quote_close on public.quotations_db;
create trigger trg_release_holds_on_quote_close
  after update of quote_status on public.quotations_db
  for each row execute function public.release_holds_on_quote_close();

-- 9) Días ocupados del cotizador con horario semanal (CAL-09) -------------------
-- Marca 'unavailable' los días deshabilitados en el horario del artista
-- (app_settings.availability) o en ubicaciones pausadas; 'full' usa como umbral
-- las horas del día según el horario (8 si no hay horario) y suma las citas de
-- estudio. Sin horario guardado no marca días por horario (comportamiento previo).
create or replace function public.list_artist_public_busy_days(
  p_artist_user_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (busy_date date, busy_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_from date;
  v_to date;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_avail jsonb;
begin
  if p_artist_user_id is null
     or not exists (select 1 from public.artists_db a where a.user_id = p_artist_user_id) then
    return;
  end if;

  v_tz := private.wo_artist_timezone(p_artist_user_id);
  v_from := greatest(coalesce(p_from, (pg_catalog.now() at time zone v_tz)::date), (pg_catalog.now() at time zone v_tz)::date);
  v_to := least(coalesce(p_to, v_from + 62), v_from + 186);
  if v_to < v_from then
    return;
  end if;
  v_range_start := v_from::timestamp at time zone v_tz;
  v_range_end := (v_to + 1)::timestamp at time zone v_tz;
  select up.app_settings -> 'availability' into v_avail
  from public.user_preferences up where up.user_id = p_artist_user_id;

  return query
  with manual as (
    select
      e.event_type,
      e.all_day,
      e.status,
      e.starts_at + (g.n * interval '7 days') as occ_start,
      e.ends_at + (g.n * interval '7 days') as occ_end,
      e.recurrence_until
    from public.artist_calendar_events e
    cross join lateral pg_catalog.generate_series(
      0,
      case when e.recurrence_rule = 'weekly' then 103 else 0 end
    ) as g(n)
    where e.artist_user_id = p_artist_user_id
      and e.status <> 'cancelled'
      and e.event_type in (
        'blocked_day', 'guest_spot', 'convention', 'personal',
        'availability', 'reservation', 'confirmed_session'
      )
      and e.starts_at < v_range_end
  ), manual_in_range as (
    select m.*
    from manual m
    where m.occ_start < v_range_end
      and m.occ_end > v_range_start
      and (
        m.recurrence_until is null
        or (m.occ_start at time zone v_tz)::date <= m.recurrence_until
      )
  ), days as (
    select d::date as d
    from pg_catalog.generate_series(v_from, v_to, interval '1 day') as d
  ), loc as (
    -- Ubicación vigente por día: el destino Travel que cubre la fecha; si no,
    -- la ubicación base (current de menor sort_order).
    select dd.d,
           coalesce(
             (select l.id from public.artist_tattoo_locations l
               where l.artist_user_id = p_artist_user_id and l.period_type = 'upcoming'
                 and l.start_date <= dd.d and l.end_date >= dd.d
               order by l.start_date desc limit 1),
             (select l.id from public.artist_tattoo_locations l
               where l.artist_user_id = p_artist_user_id and l.period_type = 'current'
               order by l.sort_order, l.created_at limit 1)
           ) as loc_id
    from days dd
  ), sched as (
    select lc.d,
           l.agenda_status,
           w.row as day_row
    from loc lc
    left join public.artist_tattoo_locations l on l.id = lc.loc_id
    cross join lateral (
      select coalesce(
        case when lc.loc_id is not null then v_avail -> 'locations' -> (lc.loc_id::text) -> 'weekly' end,
        case when l.period_type is distinct from 'upcoming' then v_avail -> 'weekly' end
      ) as weekly
    ) ws
    cross join lateral (
      select case
        when ws.weekly is null then null
        when pg_catalog.jsonb_typeof(ws.weekly) = 'array' then (
          select x from pg_catalog.jsonb_array_elements(ws.weekly) x
          where x ->> 'day' = (array['lunes','martes','miercoles','jueves','viernes','sabado','domingo'])[extract(isodow from lc.d)::int]
          limit 1)
        when pg_catalog.jsonb_typeof(ws.weekly) = 'object' then
          ws.weekly -> ((array['lunes','martes','miercoles','jueves','viernes','sabado','domingo'])[extract(isodow from lc.d)::int])
        else null
      end as row
    ) w
  ), sched_hours as (
    select s.d,
           s.agenda_status,
           s.day_row is not null as has_schedule,
           coalesce((s.day_row ->> 'enabled')::boolean, false) as enabled,
           case
             when s.day_row is not null
               and coalesce((s.day_row ->> 'enabled')::boolean, false)
               and (s.day_row ->> 'start') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               and (s.day_row ->> 'end') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               and (s.day_row ->> 'end')::time > (s.day_row ->> 'start')::time
             then (extract(epoch from ((s.day_row ->> 'end')::time - (s.day_row ->> 'start')::time)) / 3600.0)::numeric
             else null
           end as hours
    from sched s
  ), off_days as (
    select pg_catalog.generate_series(
      (m.occ_start at time zone v_tz)::date,
      ((m.occ_end - interval '1 microsecond') at time zone v_tz)::date,
      interval '1 day'
    )::date as d
    from manual_in_range m
    where (
        m.event_type in ('blocked_day', 'guest_spot', 'convention')
        and (m.all_day or m.occ_end - m.occ_start >= interval '6 hours')
      )
      or (m.event_type = 'personal' and m.all_day)
    union all
    select pg_catalog.generate_series(t.start_date, t.end_date, interval '1 day')::date
    from public.artist_trips t
    where t.artist_user_id = p_artist_user_id
      and t.status = 'confirmado'
      and t.cancelled_at is null
      and t.start_date <= v_to
      and t.end_date >= v_from
    union all
    select pg_catalog.generate_series(a.vacation_start, a.vacation_end, interval '1 day')::date
    from public.artists_db a
    where a.user_id = p_artist_user_id
      and a.vacation_start is not null
      and a.vacation_end is not null
      and a.vacation_end >= a.vacation_start
      and a.vacation_start <= v_to
      and a.vacation_end >= v_from
    union all
    select sh.d from sched_hours sh
    where sh.agenda_status = 'closed'
       or (sh.has_schedule and (not sh.enabled or sh.hours is null))
  ), booked as (
    select (s.session_date at time zone v_tz)::date as d,
           coalesce(nullif(s.duration_hours, 0), 1)::numeric as hours
    from public.quotation_sessions s
    join public.quotations_db q on q.id = s.quotation_id
    where q.artist_id::text = p_artist_user_id::text
      and coalesce(s.status, 'scheduled') not in ('cancelled', 'canceled', 'cancelada')
      and s.session_date >= v_range_start
      and s.session_date < v_range_end
    union all
    select (m.occ_start at time zone v_tz)::date,
           (extract(epoch from (m.occ_end - m.occ_start)) / 3600.0)::numeric
    from manual_in_range m
    where m.event_type in ('reservation', 'confirmed_session')
      and not m.all_day
    union all
    select (b.starts_at at time zone v_tz)::date,
           (extract(epoch from (b.ends_at - b.starts_at)) / 3600.0)::numeric
    from public.studio_bookings b
    where b.artist_user_id = p_artist_user_id
      and b.status = 'confirmed'
      and b.starts_at >= v_range_start
      and b.starts_at < v_range_end
  ), marks as (
    select o.d, 3 as lvl from off_days o
    union all
    select b.d, 2
    from booked b
    left join sched_hours sh on sh.d = b.d
    group by b.d
    having sum(b.hours) >= coalesce(max(sh.hours), 8)
    union all
    select pg_catalog.generate_series(
      (m.occ_start at time zone v_tz)::date,
      ((m.occ_end - interval '1 microsecond') at time zone v_tz)::date,
      interval '1 day'
    )::date, 1
    from manual_in_range m
    where m.event_type = 'availability'
  )
  select mk.d, (array['available', 'full', 'unavailable'])[max(mk.lvl)]
  from marks mk
  where mk.d between v_from and v_to
  group by mk.d
  order by mk.d;
end;
$$;

revoke all on function public.list_artist_public_busy_days(uuid, date, date) from public;
grant execute on function public.list_artist_public_busy_days(uuid, date, date)
  to anon, authenticated, service_role;

commit;
