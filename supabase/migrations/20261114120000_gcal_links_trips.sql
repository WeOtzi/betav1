-- Google Calendar · vínculos de viajes (14 nov 2026, 2.2.15).
--
-- 2.2.14 publica los viajes de Travel con source_key 'trip:<uuid>', pero el
-- check de artist_google_calendar_event_links solo aceptaba event|session: el
-- evento se creaba en Google, el vínculo no se guardaba y cada sincronización
-- lo volvía a crear (duplicados). Se amplía el check a 'trip'.
--
-- Aditiva. Reversa: supabase/rollbacks/20261114120000_gcal_links_trips.down.sql

begin;

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_source_key_check;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_source_key_check
  check (source_key ~ '^(event|session|trip):[A-Za-z0-9-]{1,64}$');

commit;
