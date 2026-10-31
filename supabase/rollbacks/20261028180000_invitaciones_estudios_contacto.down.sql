-- Reversa de supabase/migrations/20261028180000_invitaciones_estudios_contacto.sql
-- Quita la RPC de contacto artista → estudio y las columnas del perfil de
-- trabajo del estudio. Los hilos studio_contact ya creados en el Inbox
-- unificado se conservan (son conversaciones normales del Inbox).

begin;

drop function if exists public.contact_studio_as_artist(uuid, text, text, date, date, boolean);

alter table public.studios
  drop constraint if exists studios_station_count_range,
  drop constraint if exists studios_default_split_range,
  drop constraint if exists studios_guest_window_order;

alter table public.studios
  drop column if exists specialty_styles,
  drop column if exists station_count,
  drop column if exists equipment,
  drop column if exists artist_requirements,
  drop column if exists default_revenue_split_pct,
  drop column if exists accepts_guest_spots,
  drop column if exists guest_window_start,
  drop column if exists guest_window_end,
  drop column if exists accepts_artist_inquiries;

notify pgrst, 'reload schema';

commit;
