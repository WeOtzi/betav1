-- Beta cerrada · Marketplace (MK-05, MK-11, MK-12, MK-10).
--
-- Qué hace (idempotente; no toca datos):
--   1. public.artists_with_location (la vista que alimenta /explore y el globo)
--      se recrea con las MISMAS columnas y en el mismo orden, más dos al final:
--        - session_price_amount_usd: el filtro de precio compara en USD
--          normalizados, no parseando el texto libre de session_price.
--        - verification_state: sello y filtro "Verificados" (valor 'Yes').
--      Además studio_phone deja de salir de studios.contact_phone (teléfono
--      interno de contacto con We Ötzi, privado desde 20261115200100) y pasa a
--      ser el teléfono PÚBLICO: el de la sede principal o el del estudio.
--      Se mantiene security_barrier y el filtro de registros 'incompleto'.
--   2. public.public_artist_trips: vista security_barrier sobre artist_trips
--      (cuya RLS solo deja leer al dueño y a soporte) con lo mínimo para el
--      filtro "Viajes" del marketplace: artista, ciudad, país, fechas y tipo.
--      Solo viajes vigentes (status 'planificado' o 'confirmado', sin
--      cancelar, que no terminaron) de artistas con registro completo. Nunca
--      expone notas, condiciones, share_slug ni contadores.
--
-- Reversa: supabase/rollbacks/20261115200000_marketplace_vistas_publicas.down.sql

-- 1) artists_with_location v4 -------------------------------------------------

create or replace view public.artists_with_location
with (security_barrier = true)
as
select
  a.id,
  a.user_id,
  a.username,
  a.name,
  a.profile_picture,
  a.styles_array,
  a.session_price,
  a.years_experience,
  a.languages,
  a.bio_description,
  a.is_recommended,
  a.work_type,
  a.studio_id,
  case when s.id is not null then 'studio'::text else 'independent'::text end as location_source,
  s.name as studio_name,
  s.slug as studio_slug,
  coalesce(sl.country, a.country) as country,
  coalesce(sl.country_code, a.country_code) as country_code,
  coalesce(sl.state_province, a.state_province) as state_province,
  coalesce(sl.city, a.city) as city,
  coalesce(sl.locality, a.locality) as locality,
  sl.street,
  sl.street_number,
  sl.unit,
  sl.postal_code,
  case
    when sl.id is not null then coalesce(sl.formatted_address, sl.city)
    else coalesce(
      nullif(btrim(a.ubicacion), ''::text),
      nullif(concat_ws(', '::text, nullif(btrim(a.city), ''::text), nullif(btrim(a.country), ''::text)), ''::text)
    )
  end as formatted_address,
  case
    when sl.id is not null then sl.latitude
    else (round((a.latitude)::numeric, 2))::double precision
  end as latitude,
  case
    when sl.id is not null then sl.longitude
    else (round((a.longitude)::numeric, 2))::double precision
  end as longitude,
  sl.google_place_id,
  coalesce(nullif(btrim(sl.phone), ''::text), nullif(btrim(s.phone), ''::text)) as studio_phone,
  s.instagram as studio_instagram,
  s.website as studio_website,
  sl.geocoded_at,
  ((sl.id is null) and (a.latitude is not null)) as location_is_approximate,
  a.session_price_amount_usd,
  a.verification_state
from public.artists_db a
left join public.studios s
  on a.studio_id = s.id
 and a.work_type = any (array['studio'::text, 'both'::text])
left join public.studio_locations sl
  on sl.id = s.primary_location_id
where a.registration_status is distinct from 'incompleto'::text;

comment on view public.artists_with_location is
  'Perfil público del artista + dirección de la sede del estudio (COALESCE). Sin datos exactos del independiente (lat/lng a 2 decimales). v4 (20261115200000): suma session_price_amount_usd y verification_state; studio_phone = teléfono público de la sede/estudio.';

grant select on public.artists_with_location to anon, authenticated, service_role;

-- 2) Viajes públicos (Travel) -------------------------------------------------

create or replace view public.public_artist_trips
with (security_barrier = true)
as
select
  t.id,
  t.artist_user_id,
  t.city,
  t.country,
  t.start_date,
  t.end_date,
  t.trip_type
from public.artist_trips t
join public.artists_db a
  on a.user_id = t.artist_user_id
where t.status = any (array['planificado'::text, 'confirmado'::text])
  and t.cancelled_at is null
  and t.end_date >= current_date
  and a.registration_status is distinct from 'incompleto'::text;

comment on view public.public_artist_trips is
  'Marketplace: viajes vigentes (planificado/confirmado, sin cancelar, sin terminar) de artistas públicos. Solo artista, ciudad, país, fechas y tipo; nunca notas, condiciones ni share_slug.';

revoke all on public.public_artist_trips from public, anon, authenticated;
grant select on public.public_artist_trips to anon, authenticated, service_role;
