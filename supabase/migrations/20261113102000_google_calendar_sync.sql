-- Ronda 3b · grupo "gcal": integración real con Google Calendar (Cuenta 801:571
-- "Conectar / Conectado" y el calendario del artista).
--
-- 1) artist_google_calendar_connections: una conexión por artista con el
--    refresh token CIFRADO (AES-256-GCM en el servidor, GCAL_TOKEN_ENC_KEY).
--    Sin policies y sin grants para anon/authenticated: SOLO service_role.
-- 2) artist_google_calendar_event_links: qué evento de We Ötzi se publicó como
--    qué evento de Google (para actualizar/borrar sin duplicar). Solo service_role.
-- 3) artist_google_calendar_busy: bloques "ocupado" importados de Google
--    (solo horario, sin títulos). El artista lee los suyos; escribe el servidor.
-- 4) artist_calendar_events.google_event_id (quotation_sessions ya la tiene).
-- 5) get_my_google_calendar_connection(): estado visible para el artista
--    (conectado, email, última sincronización, error) sin exponer el token.
-- 6) gcal_replace_busy_blocks(): reemplazo atómico de los bloques (service_role).
-- 7) list_artist_public_busy_days(): misma función de 20261112190000 más los
--    bloques de Google (todo el día o >= 6 h → sin agenda; el resto suma horas).
-- 8) Resuelve el viejo pedido 'pending' de artist_integration_connections.
--
-- Depende de 20261112190000_calendar_reminders_busy_days.sql
-- (private.wo_artist_timezone). Aditiva e idempotente. NO aplicada.
-- Reversa: supabase/rollbacks/20261113102000_google_calendar_sync.down.sql

-- 1) Conexiones ---------------------------------------------------------------
create table if not exists public.artist_google_calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  google_email text check (google_email is null or char_length(google_email) <= 320),
  refresh_token_enc text not null check (refresh_token_enc like 'v1:%' and char_length(refresh_token_enc) <= 4096),
  scope text check (scope is null or char_length(scope) <= 500),
  calendar_id text not null default 'primary' check (char_length(calendar_id) between 1 and 300),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  needs_reauth boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.artist_google_calendar_connections is
  'Conexión OAuth de Google Calendar por artista. refresh_token_enc cifrado en el servidor; solo service_role.';

drop trigger if exists trg_artist_gcal_connections_updated_at on public.artist_google_calendar_connections;
create trigger trg_artist_gcal_connections_updated_at
  before update on public.artist_google_calendar_connections
  for each row execute function public.set_updated_at();

alter table public.artist_google_calendar_connections enable row level security;
revoke all on table public.artist_google_calendar_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.artist_google_calendar_connections to service_role;

-- 2) Vínculos evento We Ötzi ↔ evento de Google --------------------------------
create table if not exists public.artist_google_calendar_event_links (
  user_id uuid not null references public.artist_google_calendar_connections (user_id) on delete cascade,
  source_key text not null check (source_key ~ '^(event|session):[A-Za-z0-9-]{1,64}$'),
  google_event_id text not null check (char_length(google_event_id) between 1 and 1024),
  content_hash text not null check (char_length(content_hash) = 64),
  synced_at timestamptz not null default now(),
  primary key (user_id, source_key)
);

alter table public.artist_google_calendar_event_links enable row level security;
revoke all on table public.artist_google_calendar_event_links from public, anon, authenticated;
grant select, insert, update, delete on table public.artist_google_calendar_event_links to service_role;

-- 3) Bloques "ocupado" importados de Google ------------------------------------
create table if not exists public.artist_google_calendar_busy (
  user_id uuid not null references public.artist_google_calendar_connections (user_id) on delete cascade,
  google_event_id text not null check (char_length(google_event_id) between 1 and 1024),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  synced_at timestamptz not null default now(),
  primary key (user_id, google_event_id),
  constraint artist_google_calendar_busy_range_check check (ends_at > starts_at)
);

create index if not exists idx_artist_google_calendar_busy_range
  on public.artist_google_calendar_busy (user_id, starts_at, ends_at);

comment on table public.artist_google_calendar_busy is
  'Horarios ocupados importados de Google Calendar (sin títulos ni detalles). Escribe solo el servidor.';

alter table public.artist_google_calendar_busy enable row level security;
revoke all on table public.artist_google_calendar_busy from public, anon, authenticated;
grant select on table public.artist_google_calendar_busy to authenticated;
grant select, insert, update, delete on table public.artist_google_calendar_busy to service_role;

drop policy if exists artist_google_calendar_busy_owner_select on public.artist_google_calendar_busy;
create policy artist_google_calendar_busy_owner_select
  on public.artist_google_calendar_busy for select to authenticated
  using (user_id = (select auth.uid()));

-- 4) google_event_id en los eventos manuales ------------------------------------
alter table public.artist_calendar_events
  add column if not exists google_event_id text;

comment on column public.artist_calendar_events.google_event_id is
  'Evento de Google Calendar publicado desde We Ötzi (fuente de verdad: artist_google_calendar_event_links).';

-- 5) Estado para el artista ------------------------------------------------------
create or replace function public.get_my_google_calendar_connection()
returns table (
  connected boolean,
  google_email text,
  calendar_id text,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  needs_reauth boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select true, c.google_email, c.calendar_id, c.connected_at, c.last_sync_at, c.last_error, c.needs_reauth
  from public.artist_google_calendar_connections c
  where c.user_id = (select auth.uid())
  union all
  select false, null::text, null::text, null::timestamptz, null::timestamptz, null::text, false
  where (select auth.uid()) is not null
    and not exists (
      select 1 from public.artist_google_calendar_connections c
      where c.user_id = (select auth.uid())
    );
$$;

revoke all on function public.get_my_google_calendar_connection() from public, anon;
grant execute on function public.get_my_google_calendar_connection() to authenticated, service_role;

-- 6) Reemplazo atómico de los bloques importados (solo service_role) ------------
create or replace function public.gcal_replace_busy_blocks(p_user_id uuid, p_blocks jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'p_user_id requerido';
  end if;
  if not exists (select 1 from public.artist_google_calendar_connections c where c.user_id = p_user_id) then
    return 0;
  end if;

  delete from public.artist_google_calendar_busy b where b.user_id = p_user_id;

  if p_blocks is null or pg_catalog.jsonb_typeof(p_blocks) <> 'array' then
    return 0;
  end if;

  insert into public.artist_google_calendar_busy (user_id, google_event_id, starts_at, ends_at, all_day)
  select distinct on (x.google_event_id)
    p_user_id, x.google_event_id, x.starts_at, x.ends_at, coalesce(x.all_day, false)
  from pg_catalog.jsonb_to_recordset(p_blocks)
    as x(google_event_id text, starts_at timestamptz, ends_at timestamptz, all_day boolean)
  where x.google_event_id is not null
    and char_length(x.google_event_id) between 1 and 1024
    and x.starts_at is not null
    and x.ends_at > x.starts_at
  order by x.google_event_id
  limit 2000;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.gcal_replace_busy_blocks(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.gcal_replace_busy_blocks(uuid, jsonb) to service_role;

-- 7) Días ocupados para el cliente: + bloques de Google --------------------------
-- Cuerpo idéntico al de 20261112190000 salvo los dos bloques marcados "gcal".
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
  ), gcal as (
    -- gcal: bloques "ocupado" importados de Google Calendar.
    select b.starts_at as occ_start, b.ends_at as occ_end, b.all_day
    from public.artist_google_calendar_busy b
    where b.user_id = p_artist_user_id
      and b.starts_at < v_range_end
      and b.ends_at > v_range_start
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
    select pg_catalog.generate_series(
      (gb.occ_start at time zone v_tz)::date,
      ((gb.occ_end - interval '1 microsecond') at time zone v_tz)::date,
      interval '1 day'
    )::date
    from gcal gb
    where gb.all_day or gb.occ_end - gb.occ_start >= interval '6 hours'
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
    union all
    -- gcal: los bloques cortos suman horas ocupadas del día.
    select (gb.occ_start at time zone v_tz)::date,
           (extract(epoch from (gb.occ_end - gb.occ_start)) / 3600.0)::numeric
    from gcal gb
    where not gb.all_day
      and gb.occ_end - gb.occ_start < interval '6 hours'
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

-- 8) El viejo botón solo grababa un pedido 'pending' que nunca se resolvía ----
update public.artist_integration_connections
set status = 'disconnected',
    metadata_json = (metadata_json - 'authorization_required') || jsonb_build_object('superseded_by', 'oauth_20261113')
where provider = 'google_calendar'
  and status = 'pending';
