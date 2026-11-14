-- Reversa de 20261115200000_marketplace_vistas_publicas.sql.
-- El front del marketplace tolera que falten public_artist_trips (sin filtro de
-- viajes de Travel) y las columnas nuevas de artists_with_location (precio y
-- verificados de /explore quedan sin datos), pero conviene revertir el código
-- junto con esta reversa.

drop view if exists public.public_artist_trips;

-- artists_with_location v3 (20261113106000): CREATE OR REPLACE no puede quitar
-- columnas, así que se recrea. Nadie depende de la vista.
drop view if exists public.artists_with_location;

create view public.artists_with_location
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
  s.contact_phone as studio_phone,
  s.instagram as studio_instagram,
  s.website as studio_website,
  sl.geocoded_at,
  ((sl.id is null) and (a.latitude is not null)) as location_is_approximate
from public.artists_db a
left join public.studios s
  on a.studio_id = s.id
 and a.work_type = any (array['studio'::text, 'both'::text])
left join public.studio_locations sl
  on sl.id = s.primary_location_id
where a.registration_status is distinct from 'incompleto'::text;

grant select on public.artists_with_location to anon, authenticated, service_role;
