-- Google Calendar solo de ida (14 nov 2026): We Ötzi → Google.
--
-- Decisión de producto: la sincronización publica en Google los eventos del
-- artista y NO lee su calendario. Deja de importarse el horario ocupado:
--   1) list_artist_public_busy_days vuelve al cuerpo sin bloques de Google
--      (el de 20261113100500: solo viajes confirmados).
--   2) Se elimina gcal_replace_busy_blocks (la escribía el servidor al importar).
--   3) Nadie más lee artist_google_calendar_busy: se revoca el select del
--      artista. La tabla y sus filas NO se borran acá (borrar datos en vivo
--      queda para supabase/pending/20261114100500_drop_gcal_busy.sql, con OK).
--
-- Aditiva e idempotente. Reversa:
--   supabase/rollbacks/20261114100000_gcal_solo_escritura.down.sql

begin;

-- 1) Días ocupados sin Google ----------------------------------------------------
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
$$;

revoke all on function public.list_artist_public_busy_days(uuid, date, date) from public;
grant execute on function public.list_artist_public_busy_days(uuid, date, date)
  to anon, authenticated, service_role;

-- 2) Sin importación, sin función de reemplazo ---------------------------------
drop function if exists public.gcal_replace_busy_blocks(uuid, jsonb);

-- 3) Los bloques importados ya no se muestran -------------------------------------
drop policy if exists artist_google_calendar_busy_owner_select on public.artist_google_calendar_busy;
revoke all on table public.artist_google_calendar_busy from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
