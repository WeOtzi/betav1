-- Calendario profesional del artista (Figma 52:8311 y 153:4421...9373).
-- Los turnos de quotation_sessions y los viajes de artist_trips se proyectan
-- en el frontend: no se copian en esta tabla y por eso no pueden duplicarse.

create table if not exists public.artist_calendar_events (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in (
    'confirmed_session',
    'pending_request',
    'reservation',
    'blocked_day',
    'availability',
    'guest_spot',
    'convention',
    'reminder',
    'personal'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  client_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  notes text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'pending', 'completed', 'cancelled')),
  recurrence_rule text not null default 'none'
    check (recurrence_rule in ('none', 'weekly')),
  recurrence_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artist_calendar_events_range_check check (ends_at > starts_at),
  constraint artist_calendar_events_recurrence_check check (
    recurrence_rule = 'none'
    or recurrence_until is null
    or recurrence_until >= starts_at::date
  )
);

comment on table public.artist_calendar_events is
  'Eventos manuales del calendario del artista; sesiones y viajes se proyectan sin persistir duplicados.';

create index if not exists idx_artist_calendar_events_owner_range
  on public.artist_calendar_events (artist_user_id, starts_at, ends_at)
  where status <> 'cancelled';

create index if not exists idx_artist_calendar_events_owner_recurring
  on public.artist_calendar_events (artist_user_id, starts_at)
  where recurrence_rule = 'weekly' and status <> 'cancelled';

drop trigger if exists trg_artist_calendar_events_updated_at on public.artist_calendar_events;
create trigger trg_artist_calendar_events_updated_at
  before update on public.artist_calendar_events
  for each row execute function public.set_updated_at();

-- Vista previa de conflictos para el formulario. Es SECURITY INVOKER y solo
-- consulta filas que el usuario puede leer por RLS. La recurrencia semanal sin
-- fecha final se valida a dos anos (104 ocurrencias), evitando series infinitas.
create or replace function public.check_artist_calendar_conflicts(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_recurrence_rule text default 'none',
  p_recurrence_until date default null,
  p_exclude_event_id uuid default null
)
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  event_type text
)
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

-- La misma regla se aplica en servidor para todos los INSERT/UPDATE, incluso
-- si un cliente omite la vista previa. El lock por artista serializa escrituras
-- concurrentes y evita que dos eventos se cuelen entre la comprobacion y el
-- commit. Disponibilidad, recordatorios y solicitudes no bloquean horario.
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

drop trigger if exists trg_prevent_artist_calendar_overlap on public.artist_calendar_events;
create trigger trg_prevent_artist_calendar_overlap
  before insert or update of artist_user_id, event_type, starts_at, ends_at,
    status, recurrence_rule, recurrence_until
  on public.artist_calendar_events
  for each row execute function public.prevent_artist_calendar_overlap();

-- Data API: grants explicitos y RLS son capas separadas.
revoke all on table public.artist_calendar_events from anon;
grant select, insert, update, delete on table public.artist_calendar_events to authenticated;
grant select, insert, update, delete on table public.artist_calendar_events to service_role;

alter table public.artist_calendar_events enable row level security;

drop policy if exists artist_calendar_events_owner_select on public.artist_calendar_events;
create policy artist_calendar_events_owner_select
  on public.artist_calendar_events for select to authenticated
  using (
    artist_user_id = (select auth.uid())
    or (select public.is_support_user())
  );

drop policy if exists artist_calendar_events_owner_insert on public.artist_calendar_events;
create policy artist_calendar_events_owner_insert
  on public.artist_calendar_events for insert to authenticated
  with check (artist_user_id = (select auth.uid()));

drop policy if exists artist_calendar_events_owner_update on public.artist_calendar_events;
create policy artist_calendar_events_owner_update
  on public.artist_calendar_events for update to authenticated
  using (artist_user_id = (select auth.uid()))
  with check (artist_user_id = (select auth.uid()));

drop policy if exists artist_calendar_events_owner_delete on public.artist_calendar_events;
create policy artist_calendar_events_owner_delete
  on public.artist_calendar_events for delete to authenticated
  using (artist_user_id = (select auth.uid()));

revoke execute on function public.check_artist_calendar_conflicts(
  timestamptz, timestamptz, text, date, uuid
) from public, anon;
grant execute on function public.check_artist_calendar_conflicts(
  timestamptz, timestamptz, text, date, uuid
) to authenticated, service_role;

-- Las funciones de trigger no son endpoints publicos.
revoke execute on function public.prevent_artist_calendar_overlap() from public, anon, authenticated;
