-- Reversa de supabase/migrations/20261028160000_artist_residency_country_waitlist.sql
-- 1. Las residencias en 'waitlist' vuelven a 'open' (estado más cercano que el
--    CHECK original admite) antes de restaurar la restricción.
-- 2. Se elimina la columna `country` (el dato se pierde: exportalo antes si hace falta).

update public.artist_tattoo_locations
   set agenda_status = 'open'
 where agenda_status = 'waitlist';

alter table public.artist_tattoo_locations
  drop constraint if exists artist_tattoo_locations_agenda_status_check;

alter table public.artist_tattoo_locations
  add constraint artist_tattoo_locations_agenda_status_check
  check (agenda_status in ('open', 'closed'));

alter table public.artist_tattoo_locations
  drop column if exists country;
