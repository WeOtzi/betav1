-- Reversa de 20261114120000_gcal_links_trips.sql. Antes borra los vínculos de
-- viajes (si no, el check no se puede volver a crear); los eventos que quedaron
-- en Google se limpian desconectando/reconectando o a mano.

begin;

delete from public.artist_google_calendar_event_links where source_key like 'trip:%';
alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_source_key_check;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_source_key_check
  check (source_key ~ '^(event|session):[A-Za-z0-9-]{1,64}$');

commit;
