-- Ronda 2 · Inbox [P9] · Respuestas automáticas del artista (16 nov 2026).
--
-- "Mensajes rápidos y automáticos en el Inbox." Dos automáticos, configurables
-- y apagables por el artista (tabla artist_inbox_automations):
--
--   (a) Saludo: responde al PRIMER mensaje de un cliente en un hilo.
--   (b) Ausencia: responde cuando el cliente escribe fuera del horario de
--       disponibilidad del artista o durante sus vacaciones.
--
-- Se ejecutan en la BASE (trigger AFTER INSERT), no en el navegador, así
-- valen para cualquier pantalla que guarde un mensaje:
--
--   · chat_messages   → chats de cotización (remitente sender_type = 'client').
--   · inbox_messages  → inbox unificado (remitente sender_role = 'client').
--
-- Garantías:
--   · Una sola vez: el saludo, una vez por hilo; la ausencia, una vez por hilo
--     y ventana (las vacaciones en curso, o el tramo cerrado desde el último
--     cierre del horario). Un advisory lock por hilo serializa los envíos
--     simultáneos.
--   · Un solo automático por mensaje del cliente (la ausencia tiene prioridad
--     sobre el saludo).
--   · Marcados: columna auto_kind ('greeting' | 'away') en el mensaje; la
--     interfaz muestra "Mensaje automático". El usuario final no puede
--     escribir esa columna (trigger de guarda).
--   · Sin bucles: solo reaccionan a mensajes de CLIENTES que no son
--     automáticos; los automáticos salen como el artista y nunca disparan otro
--     (además se corta con pg_trigger_depth).
--   · No molestan: no hay automáticos si el artista escribió a mano en el hilo
--     en la última hora (está presente), ni en cotizaciones cerradas.
--   · Nunca rompen el mensaje del cliente: cualquier error del automático se
--     descarta (bloque exception) y el mensaje original se guarda igual.
--
-- Horario: el mismo de Cuenta › Disponibilidad
-- (user_preferences.app_settings.availability, zona app_settings.timezone) y
-- las vacaciones de artists_db.vacation_start / vacation_end. Sin horario
-- guardado solo aplica la ausencia por vacaciones.
--
-- No se tocan funciones ni vistas existentes (chat_messages_before_insert,
-- send_inbox_message, touch_inbox_message_thread, chat_threads).
--
-- Idempotente. Reversa: supabase/rollbacks/20261116160200_inbox_respuestas_automaticas.down.sql

begin;

create schema if not exists private;

-- ---------------------------------------------------------------- configuración
create table if not exists public.artist_inbox_automations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  greeting_enabled boolean not null default false,
  greeting_body text not null default '',
  away_enabled boolean not null default false,
  away_off_hours boolean not null default true,
  away_vacation boolean not null default true,
  away_body text not null default '',
  away_vacation_body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_inbox_automations_lengths check (
    char_length(greeting_body) <= 600
    and char_length(away_body) <= 600
    and char_length(away_vacation_body) <= 600
  ),
  constraint artist_inbox_automations_greeting_text check (
    not greeting_enabled or char_length(btrim(greeting_body)) >= 1
  ),
  constraint artist_inbox_automations_away_text check (
    not away_enabled or char_length(btrim(away_body)) >= 1
  ),
  constraint artist_inbox_automations_away_scope check (
    not away_enabled or away_off_hours or away_vacation
  )
);

alter table public.artist_inbox_automations enable row level security;

drop policy if exists artist_inbox_automations_owner_select on public.artist_inbox_automations;
create policy artist_inbox_automations_owner_select
  on public.artist_inbox_automations for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists artist_inbox_automations_owner_insert on public.artist_inbox_automations;
create policy artist_inbox_automations_owner_insert
  on public.artist_inbox_automations for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists artist_inbox_automations_owner_update on public.artist_inbox_automations;
create policy artist_inbox_automations_owner_update
  on public.artist_inbox_automations for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists artist_inbox_automations_owner_delete on public.artist_inbox_automations;
create policy artist_inbox_automations_owner_delete
  on public.artist_inbox_automations for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.artist_inbox_automations from anon;
grant select, insert, update, delete on table public.artist_inbox_automations to authenticated;

drop trigger if exists trg_artist_inbox_automations_updated_at on public.artist_inbox_automations;
create trigger trg_artist_inbox_automations_updated_at
  before update on public.artist_inbox_automations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- marca en el mensaje
alter table public.chat_messages add column if not exists auto_kind text;
alter table public.inbox_messages add column if not exists auto_kind text;

alter table public.chat_messages drop constraint if exists chat_messages_auto_kind_check;
alter table public.chat_messages
  add constraint chat_messages_auto_kind_check
  check (auto_kind is null or auto_kind in ('greeting', 'away'));

alter table public.inbox_messages drop constraint if exists inbox_messages_auto_kind_check;
alter table public.inbox_messages
  add constraint inbox_messages_auto_kind_check
  check (auto_kind is null or auto_kind in ('greeting', 'away'));

create index if not exists idx_chat_messages_auto
  on public.chat_messages (quotation_id, auto_kind, created_at desc)
  where auto_kind is not null;

create index if not exists idx_inbox_messages_auto
  on public.inbox_messages (thread_id, auto_kind, created_at desc)
  where auto_kind is not null;

-- Guarda: auto_kind solo lo escribe el trigger de respuestas automáticas
-- (que corre anidado y levanta la bandera weotzi.inbox_auto en su transacción).
-- A un automático legítimo se le da una hora posterior a la del mensaje que
-- lo originó (now() es la misma para toda la transacción) para que el hilo
-- quede en orden. Corre después de chat_messages_before_insert (orden
-- alfabético de triggers), que fija created_at = now().
create or replace function private.inbox_auto_guard_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auto_kind is not null then
    if pg_trigger_depth() > 1
       and coalesce(current_setting('weotzi.inbox_auto', true), '') = '1' then
      new.created_at := greatest(clock_timestamp(), now() + interval '1 millisecond');
    else
      new.auto_kind := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.inbox_auto_guard_before_insert() from public, anon, authenticated;

drop trigger if exists trg_chat_messages_inbox_auto_guard on public.chat_messages;
create trigger trg_chat_messages_inbox_auto_guard
  before insert on public.chat_messages
  for each row execute function private.inbox_auto_guard_before_insert();

drop trigger if exists trg_inbox_messages_inbox_auto_guard on public.inbox_messages;
create trigger trg_inbox_messages_inbox_auto_guard
  before insert on public.inbox_messages
  for each row execute function private.inbox_auto_guard_before_insert();

-- ---------------------------------------------------------------- horario
-- Fila del horario semanal para un día (0 = lunes … 6 = domingo). Mismo
-- criterio que account-availability-model.js (normalizeWeekly): acepta el
-- arreglo histórico [{day, enabled, start, end}] o un objeto por día; lo que
-- falta toma el default (lunes a viernes, 10:00 a 19:00).
create or replace function private.inbox_weekly_row(p_weekly jsonb, p_day_index integer)
returns table (enabled boolean, start_time time, end_time time)
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_keys constant text[] := array['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  v_key text := c_keys[p_day_index + 1];
  v_src jsonb;
begin
  enabled := false;
  start_time := time '10:00';
  end_time := time '19:00';
  if p_weekly is null or v_key is null then
    return next;
    return;
  end if;

  if jsonb_typeof(p_weekly) = 'array' then
    select e into v_src
    from jsonb_array_elements(p_weekly) as e
    where jsonb_typeof(e) = 'object' and e ->> 'day' = v_key
    limit 1;
    if v_src is null then
      v_src := p_weekly -> p_day_index;
    end if;
  elsif jsonb_typeof(p_weekly) = 'object' then
    v_src := p_weekly -> v_key;
  end if;

  if v_src is null or jsonb_typeof(v_src) <> 'object' then
    enabled := p_day_index between 0 and 4;
    return next;
    return;
  end if;

  enabled := coalesce(v_src ->> 'enabled', '') not in ('', 'false', '0', 'null');
  if coalesce(v_src ->> 'start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    start_time := (v_src ->> 'start')::time;
  end if;
  if coalesce(v_src ->> 'end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    end_time := (v_src ->> 'end')::time;
  end if;
  if end_time <= start_time then
    enabled := false;
  end if;
  return next;
end;
$$;

-- Horario semanal vigente para una fecha: el del destino Travel que cubre el
-- día si tiene horario propio; si no, el de la ubicación base (o el horario
-- general availability.weekly). null = el artista no guardó ningún horario.
create or replace function private.inbox_effective_weekly(p_artist uuid, p_availability jsonb, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_loc text;
  v_weekly jsonb;
begin
  if p_availability is null or jsonb_typeof(p_availability) <> 'object' then
    return null;
  end if;

  select l.id::text into v_loc
  from public.artist_tattoo_locations l
  where l.artist_user_id = p_artist
    and l.period_type = 'upcoming'
    and l.start_date is not null and l.end_date is not null
    and l.start_date <= p_day and l.end_date >= p_day
  order by l.start_date desc
  limit 1;
  if v_loc is not null then
    v_weekly := p_availability #> array['locations', v_loc, 'weekly'];
    if jsonb_typeof(v_weekly) in ('array', 'object') then
      return v_weekly;
    end if;
  end if;

  select l.id::text into v_loc
  from public.artist_tattoo_locations l
  where l.artist_user_id = p_artist
    and l.period_type is distinct from 'upcoming'
  order by coalesce(l.sort_order, 0), l.created_at
  limit 1;
  if v_loc is not null then
    v_weekly := p_availability #> array['locations', v_loc, 'weekly'];
    if jsonb_typeof(v_weekly) in ('array', 'object') then
      return v_weekly;
    end if;
  end if;

  v_weekly := p_availability -> 'weekly';
  if jsonb_typeof(v_weekly) in ('array', 'object') then
    return v_weekly;
  end if;
  return null;
end;
$$;

-- Estado de ausencia del artista en un instante:
--   { away, reason: 'vacation' | 'off_hours' | 'open' | 'no_schedule',
--     window_start, vacation_end, open_until, next_open, has_schedule, timezone }
-- window_start = desde cuándo corre la ausencia actual (para enviar una sola
-- respuesta por hilo y ventana).
create or replace function private.inbox_artist_away_state(p_artist uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_default_tz constant text := 'America/Argentina/Buenos_Aires';
  v_settings jsonb;
  v_availability jsonb;
  v_tz text;
  v_local timestamp;
  v_today date;
  v_day date;
  v_vac_start date;
  v_vac_end date;
  v_swap date;
  v_weekly jsonb;
  v_has_schedule boolean;
  v_enabled boolean;
  v_start time;
  v_end time;
  v_edge timestamptz;
  v_window_start timestamptz;
  v_next_open timestamptz;
  i integer;
begin
  select up.app_settings into v_settings
  from public.user_preferences up
  where up.user_id = p_artist;

  v_tz := nullif(btrim(coalesce(v_settings ->> 'timezone', '')), '');
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_tz) then
    v_tz := c_default_tz;
  end if;
  v_local := p_at at time zone v_tz;
  v_today := v_local::date;

  if jsonb_typeof(v_settings -> 'availability') = 'object' then
    v_availability := v_settings -> 'availability';
  end if;
  v_weekly := private.inbox_effective_weekly(p_artist, v_availability, v_today);
  v_has_schedule := v_weekly is not null;

  -- Vacaciones (fechas inclusive, en la zona del artista).
  select a.vacation_start, a.vacation_end into v_vac_start, v_vac_end
  from public.artists_db a
  where a.user_id = p_artist
  limit 1;
  v_vac_start := coalesce(v_vac_start, v_vac_end);
  v_vac_end := coalesce(v_vac_end, v_vac_start);
  if v_vac_start is not null and v_vac_end < v_vac_start then
    v_swap := v_vac_start;
    v_vac_start := v_vac_end;
    v_vac_end := v_swap;
  end if;
  if v_vac_start is not null and v_today between v_vac_start and v_vac_end then
    return jsonb_build_object(
      'away', true, 'reason', 'vacation',
      'window_start', (v_vac_start::timestamp at time zone v_tz),
      'vacation_end', v_vac_end,
      'has_schedule', v_has_schedule, 'timezone', v_tz
    );
  end if;

  if not v_has_schedule then
    return jsonb_build_object('away', false, 'reason', 'no_schedule', 'has_schedule', false, 'timezone', v_tz);
  end if;

  select r.enabled, r.start_time, r.end_time into v_enabled, v_start, v_end
  from private.inbox_weekly_row(v_weekly, extract(isodow from v_today)::integer - 1) r;
  if v_enabled and v_local::time >= v_start and v_local::time < v_end then
    return jsonb_build_object(
      'away', false, 'reason', 'open',
      'open_until', to_char(v_end, 'HH24:MI'),
      'has_schedule', true, 'timezone', v_tz
    );
  end if;

  -- Fuera de horario: la ventana empieza en el último cierre (hasta 8 días atrás).
  for i in 0..8 loop
    v_day := v_today - i;
    select r.enabled, r.end_time into v_enabled, v_end
    from private.inbox_weekly_row(
      private.inbox_effective_weekly(p_artist, v_availability, v_day),
      extract(isodow from v_day)::integer - 1
    ) r;
    if v_enabled then
      v_edge := (v_day + v_end) at time zone v_tz;
      if v_edge <= p_at then
        v_window_start := v_edge;
        exit;
      end if;
    end if;
  end loop;
  if v_window_start is null then
    v_window_start := p_at - interval '7 days';
  end if;

  -- Próxima apertura (dato para la interfaz).
  for i in 0..8 loop
    v_day := v_today + i;
    select r.enabled, r.start_time into v_enabled, v_start
    from private.inbox_weekly_row(
      private.inbox_effective_weekly(p_artist, v_availability, v_day),
      extract(isodow from v_day)::integer - 1
    ) r;
    if v_enabled then
      v_edge := (v_day + v_start) at time zone v_tz;
      if v_edge > p_at then
        v_next_open := v_edge;
        exit;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'away', true, 'reason', 'off_hours',
    'window_start', v_window_start,
    'next_open', v_next_open,
    'has_schedule', true, 'timezone', v_tz
  );
end;
$$;

revoke all on function private.inbox_weekly_row(jsonb, integer) from public, anon, authenticated;
revoke all on function private.inbox_effective_weekly(uuid, jsonb, date) from public, anon, authenticated;
revoke all on function private.inbox_artist_away_state(uuid, timestamptz) from public, anon, authenticated;

-- Qué automático corresponde (o ninguno). Decisión común a los dos triggers:
-- recibe lo que cada tabla sabe del hilo y devuelve tipo y texto.
create or replace function private.inbox_auto_reply_pick(
  p_artist uuid,
  p_is_first_client_message boolean,
  p_greeting_sent boolean,
  p_last_away_at timestamptz,
  p_artist_wrote_recently boolean,
  out kind text,
  out body text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.artist_inbox_automations%rowtype;
  v_state jsonb;
  v_reason text;
begin
  kind := null;
  body := null;
  select * into v_cfg from public.artist_inbox_automations c where c.user_id = p_artist;
  if not found or not (v_cfg.greeting_enabled or v_cfg.away_enabled) then
    return;
  end if;

  -- Si el artista escribió a mano hace poco está presente: no hay automáticos.
  if coalesce(p_artist_wrote_recently, false) then
    return;
  end if;

  if v_cfg.away_enabled then
    v_state := private.inbox_artist_away_state(p_artist, now());
    v_reason := v_state ->> 'reason';
    if coalesce((v_state ->> 'away')::boolean, false)
       and ((v_reason = 'vacation' and v_cfg.away_vacation) or (v_reason = 'off_hours' and v_cfg.away_off_hours))
       and (p_last_away_at is null or p_last_away_at < (v_state ->> 'window_start')::timestamptz) then
      kind := 'away';
      body := case
        when v_reason = 'vacation' and btrim(v_cfg.away_vacation_body) <> '' then v_cfg.away_vacation_body
        else v_cfg.away_body
      end;
    end if;
  end if;

  if kind is null and v_cfg.greeting_enabled
     and coalesce(p_is_first_client_message, false)
     and not coalesce(p_greeting_sent, false) then
    kind := 'greeting';
    body := v_cfg.greeting_body;
  end if;

  body := left(btrim(coalesce(body, '')), 2000);
  if body = '' then
    kind := null;
    body := null;
  end if;
end;
$$;

revoke all on function private.inbox_auto_reply_pick(uuid, boolean, boolean, timestamptz, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- chats de cotización
create or replace function private.chat_messages_auto_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_status text;
  v_kind text;
  v_body text;
begin
  if new.sender_type is distinct from 'client' or new.auto_kind is not null or pg_trigger_depth() > 1 then
    return new;
  end if;

  begin
    select q.artist_id, lower(coalesce(q.quote_status, '')) into v_artist, v_status
    from public.quotations_db q
    where q.quote_id::text = new.quotation_id
    limit 1;
    if not found or v_artist is null or v_artist = new.sender_id
       or v_status in ('client_rejected', 'completed', 'expired', 'cancelled', 'canceled', 'rejected') then
      return new;
    end if;
    if not exists (
      select 1 from public.artist_inbox_automations c
      where c.user_id = v_artist and (c.greeting_enabled or c.away_enabled)
    ) then
      return new;
    end if;

    -- Un envío a la vez por hilo: el segundo ve lo que guardó el primero.
    perform pg_advisory_xact_lock(hashtextextended('weotzi:inbox-auto:chat:' || new.quotation_id, 0));

    select p.kind, p.body into v_kind, v_body
    from private.inbox_auto_reply_pick(
      v_artist,
      not exists (
        select 1 from public.chat_messages m
        where m.quotation_id = new.quotation_id and m.sender_type = 'client' and m.id <> new.id
      ),
      exists (
        select 1 from public.chat_messages m
        where m.quotation_id = new.quotation_id and m.auto_kind = 'greeting'
      ),
      (
        select max(m.created_at) from public.chat_messages m
        where m.quotation_id = new.quotation_id and m.auto_kind = 'away'
      ),
      exists (
        select 1 from public.chat_messages m
        where m.quotation_id = new.quotation_id and m.sender_type = 'artist'
          and m.auto_kind is null and m.created_at > now() - interval '60 minutes'
      )
    ) p;
    if v_kind is null then
      return new;
    end if;

    perform set_config('weotzi.inbox_auto', '1', true);
    insert into public.chat_messages (quotation_id, sender_type, sender_id, message, is_read, auto_kind)
    values (new.quotation_id, 'artist', v_artist, v_body, false, v_kind);
    perform set_config('weotzi.inbox_auto', '', true);
  exception when others then
    -- El automático nunca impide guardar el mensaje del cliente.
    perform set_config('weotzi.inbox_auto', '', true);
    raise warning 'inbox auto-reply (chat) omitido: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.chat_messages_auto_reply() from public, anon, authenticated;

drop trigger if exists trg_chat_messages_zz_auto_reply on public.chat_messages;
create trigger trg_chat_messages_zz_auto_reply
  after insert on public.chat_messages
  for each row
  when (new.sender_type = 'client' and new.auto_kind is null)
  execute function private.chat_messages_auto_reply();

-- ---------------------------------------------------------------- inbox unificado
-- El nombre trg_zz_… lo hace correr después de trg_touch_inbox_message_thread:
-- el último mensaje del hilo queda siendo el automático.
create or replace function private.inbox_messages_auto_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist uuid;
  v_thread_status text;
  v_quote_status text;
  v_kind text;
  v_body text;
begin
  if new.sender_role is distinct from 'client' or new.sender_user_id is null
     or new.auto_kind is not null or pg_trigger_depth() > 1 then
    return new;
  end if;

  begin
    select t.artist_user_id, t.status, lower(coalesce(t.context ->> 'quote_status', ''))
      into v_artist, v_thread_status, v_quote_status
    from public.inbox_threads t
    where t.id = new.thread_id;
    if not found or v_artist is null or v_artist = new.sender_user_id
       or v_thread_status is distinct from 'open'
       or v_quote_status in ('client_rejected', 'completed', 'expired', 'cancelled', 'canceled', 'rejected') then
      return new;
    end if;
    if not exists (
      select 1 from public.inbox_thread_participants p
      where p.thread_id = new.thread_id and p.user_id = v_artist and p.participant_role = 'artist'
    ) then
      return new;
    end if;
    if not exists (
      select 1 from public.artist_inbox_automations c
      where c.user_id = v_artist and (c.greeting_enabled or c.away_enabled)
    ) then
      return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('weotzi:inbox-auto:inbox:' || new.thread_id::text, 0));

    select p.kind, p.body into v_kind, v_body
    from private.inbox_auto_reply_pick(
      v_artist,
      not exists (
        select 1 from public.inbox_messages m
        where m.thread_id = new.thread_id and m.sender_role = 'client' and m.id <> new.id
      ),
      exists (
        select 1 from public.inbox_messages m
        where m.thread_id = new.thread_id and m.auto_kind = 'greeting'
      ),
      (
        select max(m.created_at) from public.inbox_messages m
        where m.thread_id = new.thread_id and m.auto_kind = 'away'
      ),
      exists (
        select 1 from public.inbox_messages m
        where m.thread_id = new.thread_id and m.sender_role = 'artist'
          and m.auto_kind is null and m.created_at > now() - interval '60 minutes'
      )
    ) p;
    if v_kind is null then
      return new;
    end if;

    perform set_config('weotzi.inbox_auto', '1', true);
    insert into public.inbox_messages (thread_id, sender_user_id, sender_role, body, message_kind, auto_kind)
    values (new.thread_id, v_artist, 'artist', v_body, 'text', v_kind);
    perform set_config('weotzi.inbox_auto', '', true);
  exception when others then
    perform set_config('weotzi.inbox_auto', '', true);
    raise warning 'inbox auto-reply (inbox) omitido: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.inbox_messages_auto_reply() from public, anon, authenticated;

drop trigger if exists trg_zz_inbox_messages_auto_reply on public.inbox_messages;
create trigger trg_zz_inbox_messages_auto_reply
  after insert on public.inbox_messages
  for each row
  when (new.sender_role = 'client' and new.sender_user_id is not null and new.auto_kind is null)
  execute function private.inbox_messages_auto_reply();

-- ---------------------------------------------------------------- estado para la interfaz
-- Lo que el artista ve en "Respuestas automáticas": si ahora mismo se
-- enviaría la ausencia y por qué. Solo datos del propio usuario.
create or replace function public.get_inbox_automation_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return private.inbox_artist_away_state(auth.uid(), now()) - 'window_start';
end;
$$;

revoke all on function public.get_inbox_automation_status() from public, anon;
grant execute on function public.get_inbox_automation_status() to authenticated;

commit;
