-- Reversa de 20261115150000_gcal_fuentes_y_marca.sql.
-- Antes de volver al CHECK y a la FK anteriores borra los vínculos que ya no
-- entrarían (fuentes nuevas, y los de artistas sin conexión). Los eventos que
-- quedaron en Google se limpian a mano o reconectando.

begin;

drop trigger if exists trg_quotation_closed_cancel_sessions on public.quotations_db;
drop function if exists private.quotation_closed_cancel_sessions();

drop trigger if exists trg_gcal_dirty on public.artist_calendar_events;
drop trigger if exists trg_gcal_dirty on public.quotation_sessions;
drop trigger if exists trg_gcal_dirty on public.artist_trips;
drop trigger if exists trg_gcal_dirty on public.artist_reminders;
drop trigger if exists trg_gcal_dirty on public.studio_bookings;
drop trigger if exists trg_gcal_dirty on public.quotations_db;
drop trigger if exists trg_gcal_dirty on public.artists_db;
do $$
begin
  if to_regclass('public.artist_booking_holds') is not null then
    execute 'drop trigger if exists trg_gcal_dirty on public.artist_booking_holds';
  end if;
end;
$$;

drop function if exists private.gcal_attach_dirty_trigger(regclass, text, text, text[]);
drop function if exists private.gcal_mark_dirty();

drop index if exists public.idx_artist_gcal_connections_dirty;
alter table public.artist_google_calendar_connections drop column if exists dirty_at;

delete from public.artist_google_calendar_event_links
 where source_key !~ '^(event|session|trip):';
delete from public.artist_google_calendar_event_links l
 where not exists (select 1 from public.artist_google_calendar_connections c where c.user_id = l.user_id);

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_source_key_check;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_source_key_check
  check (source_key ~ '^(event|session|trip):[A-Za-z0-9-]{1,64}$');

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_user_id_fkey;
alter table public.artist_google_calendar_event_links
  add constraint artist_google_calendar_event_links_user_id_fkey
  foreign key (user_id) references public.artist_google_calendar_connections (user_id) on delete cascade;

alter table public.artist_google_calendar_event_links
  drop constraint if exists artist_google_calendar_event_links_google_email_check;
alter table public.artist_google_calendar_event_links
  drop column if exists google_email,
  drop column if exists source_ends_at;

commit;
