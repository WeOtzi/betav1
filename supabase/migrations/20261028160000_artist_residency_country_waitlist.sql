-- ============================================================================
-- Perfil público · "Próximas residencias" (Figma final 801:1108, oct 2026)
-- ----------------------------------------------------------------------------
-- El diseño muestra cada residencia como ciudad · PAÍS · fechas · estado, con
-- tres estados: AGENDA ABIERTA, LISTA DE ESPERA y PRÓXIMAMENTE.
-- artist_tattoo_locations no guardaba país y su CHECK solo admitía
-- open/closed. Esta migración es aditiva e idempotente:
--   1. columna opcional `country`;
--   2. `agenda_status` acepta además 'waitlist'.
-- RLS: la tabla ya tiene RLS con lectura pública y escritura del dueño
-- (20260328000000_artist_tattoo_locations.sql); las políticas cubren la columna
-- nueva sin cambios. Se re-asegura que RLS siga activa.
-- Reversa: supabase/rollbacks/20261028160000_artist_residency_country_waitlist.down.sql
-- ============================================================================

alter table public.artist_tattoo_locations
  add column if not exists country text;

comment on column public.artist_tattoo_locations.country is
  'País de la residencia (texto libre, se muestra en el perfil público junto a la ciudad).';

alter table public.artist_tattoo_locations
  drop constraint if exists artist_tattoo_locations_agenda_status_check;

alter table public.artist_tattoo_locations
  add constraint artist_tattoo_locations_agenda_status_check
  check (agenda_status in ('open', 'closed', 'waitlist'));

alter table public.artist_tattoo_locations enable row level security;
