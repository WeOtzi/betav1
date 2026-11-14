-- Reversa de 20261115160000_turnos_reservas_online.sql.
-- Restaura las versiones previas (vivas al 2026-11-14) de
-- prevent_artist_calendar_overlap, check_artist_calendar_conflicts y
-- list_artist_public_busy_days, y elimina tablas, columnas, funciones y
-- triggers de turnos. OJO: borra los apartados (artist_booking_holds) y las
-- reglas de turno; las sesiones creadas al confirmar turnos se conservan.

begin;

drop trigger if exists trg_release_holds_on_quote_close on public.quotations_db;
drop function if exists public.release_holds_on_quote_close();
drop trigger if exists trg_release_hold_on_session_cancel on public.quotation_sessions;
drop function if exists public.release_hold_on_session_cancel();
drop trigger if exists trg_prevent_quotation_session_overlap on public.quotation_sessions;
drop function if exists public.prevent_quotation_session_overlap();

drop function if exists public.expire_artist_slot_holds(integer);
drop function if exists public.release_artist_slot_hold(uuid, uuid, text);
drop function if exists public.confirm_artist_slot_hold(uuid, uuid, timestamptz, integer);
drop function if exists public.save_web_quotation_with_slot(jsonb, jsonb, jsonb);
drop function if exists public.list_artist_blocking_intervals(uuid, timestamptz, timestamptz);

-- prevent_artist_calendar_overlap previo (solo eventos manuales, invoker).
create or replace function public.prevent_artist_calendar_overlap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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

  return new;
end;
$$;

-- check_artist_calendar_conflicts previo (solo eventos manuales, invoker).
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
security invoker
set search_path = ''
as $$
  with incoming as (
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
    where e.artist_user_id = (select auth.uid())
      and e.status <> 'cancelled'
      and e.event_type in (
        'confirmed_session', 'reservation', 'blocked_day',
        'guest_spot', 'convention', 'personal'
      )
      and (p_exclude_event_id is null or e.id <> p_exclude_event_id)
  )
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
  order by e.id, e.occurrence_start;
$$;

grant execute on function public.check_artist_calendar_conflicts(timestamptz, timestamptz, text, date, uuid) to authenticated, service_role;

-- list_artist_public_busy_days previo (20261114100000: sin horario semanal).
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
as $
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
      and t.status = 'confirmado'  -- 20261113100500: solo viajes confirmados
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
$;

revoke all on function public.list_artist_public_busy_days(uuid, date, date) from public;
grant execute on function public.list_artist_public_busy_days(uuid, date, date)
  to anon, authenticated, service_role;

drop function if exists private.artist_blocking_intervals(uuid, timestamptz, timestamptz, integer, uuid, uuid, boolean);

drop table if exists public.artist_booking_holds;
drop table if exists public.artist_booking_settings;

alter table public.quotations_db drop constraint if exists quotations_db_requested_slot_minutes_check;
alter table public.quotations_db drop column if exists requested_slot_minutes;
alter table public.quotations_db drop column if exists requested_slot_start;

commit;
