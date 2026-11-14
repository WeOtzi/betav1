-- Google Calendar · todas las fuentes, propagación inmediata e historial
-- (frente gcal, beta cerrada, 15 nov 2026). Solo de ida: We Ötzi → Google.
--
-- 1) artist_google_calendar_event_links
--    · source_key acepta además reminder|booking|hold|vacation (CAL-03).
--    · source_ends_at: fin de la fuente. Lo que sale de la ventana de lectura
--      no se borra de Google (CAL-01).
--    · google_email: cuenta de Google del vínculo.
--    · La FK pasa de la conexión a auth.users: desconectar ya no borra los
--      vínculos en cascada, así reconectar la misma cuenta no duplica los
--      eventos en Google (CAL-13). Los de otra cuenta se descartan al
--      sincronizar (google_email distinto).
-- 2) artist_google_calendar_connections.dirty_at + private.gcal_mark_dirty():
--    triggers en todas las tablas fuente marcan al artista "sucio" ante
--    cualquier escritura (UI, RPC, estudio, backoffice, otros triggers) y el
--    servidor lo sincroniza en segundos (poller de lib/gcal-sync.js) (CAL-04).
--    private.gcal_attach_dirty_trigger() suma una tabla nueva en una línea
--    (p. ej. artist_booking_holds del frente "turnos").
-- 3) CAL-12: al cerrar una cotización (cancelled, expired, client_rejected)
--    sus sesiones futuras pendientes pasan a 'cancelled'.
--
-- Aditiva e idempotente. Reversa:
-- supabase/rollbacks/20261115150000_gcal_fuentes_y_marca.down.sql

begin;

-- 1) Vínculos ---------------------------------------------------------------
alter table public.artist_google_calendar_event_links
  add column if not exists source_ends_at timestamptz,
  add column if not exists google_email text;

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_google_email_check;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_google_email_check
  check (google_email is null or char_length(google_email) <= 320);

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_source_key_check;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_source_key_check
  check (source_key ~ '^(event|session|trip|reminder|booking|hold|vacation):[A-Za-z0-9-]{1,64}$');

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_user_id_fkey;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- Los vínculos existentes son de la cuenta conectada hoy.
update public.artist_google_calendar_event_links l
   set google_email = c.google_email
  from public.artist_google_calendar_connections c
 where c.user_id = l.user_id
   and l.google_email is null
   and c.google_email is not null;

comment on column public.artist_google_calendar_event_links.source_ends_at is
  'Fin de la fuente (null = repetición sin fin). Lo que terminó antes de la ventana de lectura queda en Google como historial.';
comment on column public.artist_google_calendar_event_links.google_email is
  'Cuenta de Google donde se publicó el evento. Los vínculos sobreviven a la desconexión.';

-- 2) Marca de cambios -----------------------------------------------------------
alter table public.artist_google_calendar_connections
  add column if not exists dirty_at timestamptz;

comment on column public.artist_google_calendar_connections.dirty_at is
  'Algo de la agenda del artista cambió después de la última sincronización (lo marcan los triggers private.gcal_mark_dirty).';

create index if not exists idx_artist_gcal_connections_dirty
  on public.artist_google_calendar_connections (dirty_at)
  where dirty_at is not null;

-- tg_argv[0]: columna con el artista (uuid) o con la cotización.
-- tg_argv[1]: 'direct' (uuid del artista) | 'quotation' (id de quotations_db).
-- Solo escribe si el artista tiene una conexión activa, y una vez por
-- transacción (dirty_at < now()).
create or replace function private.gcal_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col text := coalesce(nullif(tg_argv[0], ''), 'artist_user_id');
  v_mode text := coalesce(nullif(tg_argv[1], ''), 'direct');
  v_vals text[] := array[]::text[];
  v_users uuid[];
begin
  if tg_op <> 'DELETE' then
    v_vals := v_vals || (to_jsonb(new) ->> v_col);
  end if;
  if tg_op <> 'INSERT' then
    v_vals := v_vals || (to_jsonb(old) ->> v_col);
  end if;

  if v_mode = 'quotation' then
    select coalesce(array_agg(distinct q.artist_id), array[]::uuid[])
      into v_users
      from public.quotations_db q
     where q.artist_id is not null
       and q.id in (select v::integer from unnest(v_vals) v where v ~ '^[0-9]{1,9}$');
  else
    select coalesce(array_agg(distinct v::uuid), array[]::uuid[])
      into v_users
      from unnest(v_vals) v
     where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  end if;

  if coalesce(array_length(v_users, 1), 0) = 0 then
    return null;
  end if;

  update public.artist_google_calendar_connections c
     set dirty_at = now()
   where c.user_id = any (v_users)
     and c.needs_reauth = false
     and (c.dirty_at is null or c.dirty_at < now());
  return null;
end;
$$;

comment on function private.gcal_mark_dirty() is
  'Trigger: marca artist_google_calendar_connections.dirty_at del artista para que el servidor publique el cambio en Google Calendar en segundos.';

-- Engancha la marca a una tabla: una línea por tabla fuente.
--   select private.gcal_attach_dirty_trigger('public.mi_tabla', 'artist_user_id');
-- p_columns: solo dispara en updates de esas columnas (null = cualquier update).
create or replace function private.gcal_attach_dirty_trigger(
  p_table regclass,
  p_artist_column text,
  p_mode text default 'direct',
  p_columns text[] default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_update text := 'update';
begin
  if p_mode not in ('direct', 'quotation') then
    raise exception 'gcal_attach_dirty_trigger: modo inválido %', p_mode;
  end if;
  if p_columns is not null and array_length(p_columns, 1) > 0 then
    select 'update of ' || string_agg(quote_ident(c), ', ')
      into v_update
      from unnest(p_columns) c;
  end if;
  execute format('drop trigger if exists trg_gcal_dirty on %s', p_table);
  execute format(
    'create trigger trg_gcal_dirty after insert or delete or %s on %s for each row execute function private.gcal_mark_dirty(%L, %L)',
    v_update, p_table, p_artist_column, p_mode
  );
end;
$$;

comment on function private.gcal_attach_dirty_trigger(regclass, text, text, text[]) is
  'Crea (o rehace) el trigger trg_gcal_dirty de una tabla fuente de Google Calendar.';

revoke all on function private.gcal_mark_dirty() from public, anon, authenticated;
revoke all on function private.gcal_attach_dirty_trigger(regclass, text, text, text[]) from public, anon, authenticated;

-- Tablas fuente. Las columnas excluyen google_event_id (la escribe la propia
-- sincronización) y los campos que no se publican, así no hay bucles.
select private.gcal_attach_dirty_trigger('public.artist_calendar_events', 'artist_user_id', 'direct',
  array['artist_user_id', 'event_type', 'title', 'client_name', 'starts_at', 'ends_at', 'all_day',
        'location', 'notes', 'status', 'recurrence_rule', 'recurrence_until']);

select private.gcal_attach_dirty_trigger('public.quotation_sessions', 'quotation_id', 'quotation',
  array['quotation_id', 'session_date', 'duration_hours', 'status', 'notes', 'location']);

select private.gcal_attach_dirty_trigger('public.artist_trips', 'artist_user_id', 'direct',
  array['artist_user_id', 'city', 'country', 'start_date', 'end_date', 'trip_type', 'status',
        'studio_name_hint', 'event_name', 'cancelled_at']);

select private.gcal_attach_dirty_trigger('public.artist_reminders', 'artist_user_id', 'direct',
  array['artist_user_id', 'title', 'detail', 'due_date', 'due_at', 'recurrence_rule',
        'recurrence_until', 'completed_at']);

select private.gcal_attach_dirty_trigger('public.studio_bookings', 'artist_user_id', 'direct',
  array['artist_user_id', 'studio_id', 'location_id', 'starts_at', 'ends_at', 'status',
        'client_name', 'service_description']);

-- Cotización: el título de la sesión lleva el cliente y el estado decide si
-- se publica. Al borrar la cotización las sesiones caen en cascada.
drop trigger if exists trg_gcal_dirty on public.quotations_db;
create trigger trg_gcal_dirty
  after delete or update of quote_status, client_full_name, quote_id, artist_id
  on public.quotations_db
  for each row execute function private.gcal_mark_dirty('artist_id', 'direct');

-- Vacaciones (Cuenta → Disponibilidad).
drop trigger if exists trg_gcal_dirty on public.artists_db;
create trigger trg_gcal_dirty
  after update of vacation_start, vacation_end
  on public.artists_db
  for each row execute function private.gcal_mark_dirty('user_id', 'direct');

-- Solicitudes con turno apartado (frente "turnos"). Si su migración corre
-- después, la suya debe llamar a private.gcal_attach_dirty_trigger.
do $$
begin
  if to_regclass('public.artist_booking_holds') is not null then
    perform private.gcal_attach_dirty_trigger('public.artist_booking_holds', 'artist_user_id', 'direct', null);
  end if;
end;
$$;

-- 3) CAL-12: cotización cerrada → sus sesiones futuras pendientes se cancelan
create or replace function private.quotation_closed_cancel_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quote_status is distinct from old.quote_status
     and new.quote_status in ('cancelled', 'expired', 'client_rejected') then
    update public.quotation_sessions s
       set status = 'cancelled'
     where s.quotation_id = new.id
       and s.status in ('scheduled', 'rescheduled')
       and s.session_date >= now();
  end if;
  return null;
end;
$$;

comment on function private.quotation_closed_cancel_sessions() is
  'CAL-12: al cancelar, vencer o rechazar una cotización, sus sesiones futuras pendientes pasan a cancelled (salen de la agenda y de Google).';

revoke all on function private.quotation_closed_cancel_sessions() from public, anon, authenticated;

drop trigger if exists trg_quotation_closed_cancel_sessions on public.quotations_db;
create trigger trg_quotation_closed_cancel_sessions
  after update of quote_status on public.quotations_db
  for each row execute function private.quotation_closed_cancel_sessions();

commit;
