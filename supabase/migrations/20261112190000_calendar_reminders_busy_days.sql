-- Calendario del artista · ronda 3 (12 nov 2026), grupo "calendario".
-- Reporte: output/figma-v3/reports/funciones-b.md (Calendario, P1 punto 7).
--
-- 1) Recordatorio unificado con aviso real: artist_reminders suma hora
--    (due_at), repetición semanal con fin (recurrence_rule/recurrence_until) y
--    last_notified_at (última ocurrencia avisada por email). El calendario deja
--    de guardar recordatorios en artist_calendar_events: las filas viejas de
--    tipo 'reminder' se mueven a artist_reminders (en vivo hoy: 0 filas).
-- 2) claim_due_artist_reminders(): solo service_role. Marca de forma atómica
--    (skip locked) las ocurrencias vencidas que todavía no se avisaron y las
--    devuelve con el email del artista para el envío del servidor
--    (POST /api/calendar/reminders/dispatch). La notificación in-app la arma
--    el menú del artista con due_at (no necesita esta función).
-- 3) list_artist_public_busy_days(): lectura pública (anon) de días
--    no disponibles / completos / con disponibilidad para el cotizador. Solo
--    devuelve fecha + estado: nunca títulos, clientes, ciudades ni motivos.
--    Fuentes: días bloqueados, guest spots y convenciones (todo el día o 6 h o
--    más), eventos personales de todo el día, viajes de Travel no cancelados,
--    vacaciones de artists_db, y días con 8 h o más de turnos (sesiones de
--    cotización + reservas). 'available' = hay un bloque de disponibilidad.
--
-- Aditiva e idempotente. Reversa: supabase/rollbacks/20261112190000_calendar_reminders_busy_days.down.sql

-- 0) Zona horaria del artista (app_settings.timezone válida o Buenos Aires) --
create schema if not exists private;

create or replace function private.wo_artist_timezone(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select tz.name
      from public.user_preferences up
      join pg_catalog.pg_timezone_names tz on tz.name = up.app_settings ->> 'timezone'
      where up.user_id = p_user_id
      limit 1
    ),
    'America/Argentina/Buenos_Aires'
  );
$$;

revoke all on function private.wo_artist_timezone(uuid) from public, anon, authenticated;

-- 1) artist_reminders: hora, repetición y aviso -----------------------------
alter table public.artist_reminders
  add column if not exists due_at timestamptz,
  add column if not exists recurrence_rule text not null default 'none',
  add column if not exists recurrence_until date,
  add column if not exists last_notified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'artist_reminders_recurrence_rule_check'
      and conrelid = 'public.artist_reminders'::regclass
  ) then
    alter table public.artist_reminders
      add constraint artist_reminders_recurrence_rule_check
      check (recurrence_rule in ('none', 'weekly'));
  end if;
end;
$$;

create index if not exists artist_reminders_due_at_open_idx
  on public.artist_reminders (due_at)
  where completed_at is null and due_at is not null;

-- Si el artista cambia la hora o la repetición, el aviso vuelve a quedar
-- pendiente para la nueva ocurrencia.
create or replace function public.artist_reminders_reset_notice()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.due_at is distinct from old.due_at
     or new.recurrence_rule is distinct from old.recurrence_rule
     or new.recurrence_until is distinct from old.recurrence_until then
    new.last_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_artist_reminders_reset_notice on public.artist_reminders;
create trigger trg_artist_reminders_reset_notice
  before update on public.artist_reminders
  for each row execute function public.artist_reminders_reset_notice();

-- Recordatorios viejos del calendario → artist_reminders (una sola fuente).
with moved as (
  delete from public.artist_calendar_events e
  where e.event_type = 'reminder'
  returning e.*
)
insert into public.artist_reminders (
  artist_user_id, title, detail, icon, due_date, due_at,
  recurrence_rule, recurrence_until, priority, is_important,
  created_at, updated_at
)
select
  m.artist_user_id,
  left(coalesce(nullif(btrim(m.title), ''), 'Recordatorio'), 140),
  left(m.notes, 2000),
  'bell',
  (m.starts_at at time zone private.wo_artist_timezone(m.artist_user_id))::date,
  m.starts_at,
  case when m.recurrence_rule = 'weekly' then 'weekly' else 'none' end,
  m.recurrence_until,
  'normal',
  true,
  m.created_at,
  m.updated_at
from moved m
where m.status <> 'cancelled';

-- 2) Aviso por email: reclamo atómico de ocurrencias vencidas -----------------
create or replace function public.claim_due_artist_reminders(
  p_limit integer default 50,
  p_window_minutes integer default 360
)
returns table (
  reminder_id uuid,
  artist_user_id uuid,
  title text,
  detail text,
  occurrence_at timestamptz,
  artist_email text,
  artist_name text,
  artist_timezone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_window interval := pg_catalog.make_interval(
    mins => greatest(5, least(coalesce(p_window_minutes, 360), 10080))
  );
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  return query
  with candidates as (
    select
      r.id,
      case
        when r.recurrence_rule = 'weekly' then
          r.due_at + (
            pg_catalog.floor(extract(epoch from (v_now - r.due_at)) / 604800)::integer
            * interval '7 days'
          )
        else r.due_at
      end as occ
    from public.artist_reminders r
    where r.completed_at is null
      and r.due_at is not null
      and r.due_at <= v_now
  ), eligible as (
    select r.id, c.occ
    from candidates c
    join public.artist_reminders r on r.id = c.id
    where c.occ <= v_now
      and c.occ > v_now - v_window
      and (
        r.recurrence_rule <> 'weekly'
        or r.recurrence_until is null
        or (c.occ at time zone private.wo_artist_timezone(r.artist_user_id))::date <= r.recurrence_until
      )
      and (r.last_notified_at is null or r.last_notified_at < c.occ)
    order by c.occ
    limit v_limit
    for update of r skip locked
  ), marked as (
    update public.artist_reminders r
    set last_notified_at = e.occ
    from eligible e
    where r.id = e.id
    returning r.id, r.artist_user_id, r.title, r.detail, e.occ
  )
  select
    m.id,
    m.artist_user_id,
    m.title,
    m.detail,
    m.occ,
    a.email,
    coalesce(nullif(btrim(a.name), ''), a.username),
    private.wo_artist_timezone(m.artist_user_id)
  from marked m
  left join public.artists_db a on a.user_id = m.artist_user_id;
end;
$$;

revoke all on function public.claim_due_artist_reminders(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_artist_reminders(integer, integer)
  to service_role;

-- 3) Días ocupados / no disponibles para el cliente ---------------------------
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
      and t.status <> 'cancelado'
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
  ), marks as (
    select o.d, 3 as lvl from off_days o
    union all
    select b.d, 2 from booked b group by b.d having sum(b.hours) >= 8
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
