-- Figma final del flujo de artista (oct 2026) · Calendario.
-- Frame 801:547 "Nuevo turno con cliente": el turno se vincula a una
-- cotización ("Cotización a vincular *").
--
--   * Cotización aprobada / en progreso → el turno ES una sesión de la
--     cotización (public.quotation_sessions). Se agrega `location` para la
--     "Ubicación" del formulario (Estudio propio / A domicilio / Otro estudio).
--   * Cotización sin aprobar ("solo como reserva pendiente") → reserva manual en
--     public.artist_calendar_events con `quotation_id` apuntando a la
--     cotización. Cuando la cotización se aprueba, el calendario la convierte en
--     sesión y borra la reserva (sin duplicados).
--
-- Aditiva e idempotente. NO aplicada. Reversa:
-- supabase/rollbacks/20261028140000_calendar_quote_links.down.sql
-- El frontend (calendar-repo.js) reintenta sin estas columnas si todavía no
-- existen, así que la página funciona antes y después de aplicarla.

-- 1. Reserva pendiente vinculada a una cotización -------------------------------
alter table public.artist_calendar_events
  add column if not exists quotation_id integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'artist_calendar_events_quotation_id_fkey'
      and conrelid = 'public.artist_calendar_events'::regclass
  ) then
    alter table public.artist_calendar_events
      add constraint artist_calendar_events_quotation_id_fkey
      foreign key (quotation_id) references public.quotations_db (id) on delete set null;
  end if;
end $$;

create index if not exists idx_artist_calendar_events_quotation
  on public.artist_calendar_events (quotation_id)
  where quotation_id is not null;

comment on column public.artist_calendar_events.quotation_id is
  'Cotización vinculada (reserva pendiente de una cotización sin aprobar). Los turnos de cotizaciones aprobadas viven en quotation_sessions.';

-- El vínculo solo puede apuntar a cotizaciones del mismo artista.
drop policy if exists artist_calendar_events_owner_insert on public.artist_calendar_events;
create policy artist_calendar_events_owner_insert
  on public.artist_calendar_events for insert to authenticated
  with check (
    artist_user_id = (select auth.uid())
    and (
      quotation_id is null
      or exists (
        select 1 from public.quotations_db q
        where q.id = quotation_id
          and q.artist_id::text = (select auth.uid())::text
      )
    )
  );

drop policy if exists artist_calendar_events_owner_update on public.artist_calendar_events;
create policy artist_calendar_events_owner_update
  on public.artist_calendar_events for update to authenticated
  using (artist_user_id = (select auth.uid()))
  with check (
    artist_user_id = (select auth.uid())
    and (
      quotation_id is null
      or exists (
        select 1 from public.quotations_db q
        where q.id = quotation_id
          and q.artist_id::text = (select auth.uid())::text
      )
    )
  );

-- 2. Ubicación del turno en la sesión de la cotización ---------------------------
alter table public.quotation_sessions
  add column if not exists location text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotation_sessions_location_length'
      and conrelid = 'public.quotation_sessions'::regclass
  ) then
    alter table public.quotation_sessions
      add constraint quotation_sessions_location_length
      check (location is null or char_length(btrim(location)) between 1 and 120);
  end if;
end $$;

comment on column public.quotation_sessions.location is
  'Ubicación del turno elegida en el calendario (Estudio propio, A domicilio, Otro estudio).';
