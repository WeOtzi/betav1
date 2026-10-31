-- Reversa de 20261028140000_calendar_quote_links.sql (Calendario · Figma final).
-- Restaura las políticas originales de artist_calendar_events
-- (20260829145232_artist_calendar_events.sql) y quita las columnas nuevas.
-- Antes de quitar quotation_id, las reservas vinculadas conservan la referencia
-- en las notas para no perder el contexto.

update public.artist_calendar_events e
set notes = concat_ws(E'\n', nullif(e.notes, ''), 'Cotización ' || coalesce(q.quote_id, 'COT-' || q.id::text))
from public.quotations_db q
where e.quotation_id = q.id
  and (e.notes is null or e.notes not like '%Cotización ' || coalesce(q.quote_id, 'COT-' || q.id::text) || '%');

drop policy if exists artist_calendar_events_owner_insert on public.artist_calendar_events;
create policy artist_calendar_events_owner_insert
  on public.artist_calendar_events for insert to authenticated
  with check (artist_user_id = (select auth.uid()));

drop policy if exists artist_calendar_events_owner_update on public.artist_calendar_events;
create policy artist_calendar_events_owner_update
  on public.artist_calendar_events for update to authenticated
  using (artist_user_id = (select auth.uid()))
  with check (artist_user_id = (select auth.uid()));

drop index if exists public.idx_artist_calendar_events_quotation;
alter table public.artist_calendar_events
  drop constraint if exists artist_calendar_events_quotation_id_fkey;
alter table public.artist_calendar_events
  drop column if exists quotation_id;

alter table public.quotation_sessions
  drop constraint if exists quotation_sessions_location_length;
alter table public.quotation_sessions
  drop column if exists location;
