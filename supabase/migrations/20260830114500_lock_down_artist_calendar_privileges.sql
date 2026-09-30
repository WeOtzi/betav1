-- El calendario se expone por Data API únicamente con el CRUD que usa la UI.
-- TRUNCATE, TRIGGER y REFERENCES omiten o exceden el contrato de RLS esperado.

revoke all on table public.artist_calendar_events from public, anon, authenticated;
grant select, insert, update, delete on table public.artist_calendar_events to authenticated;

