-- Seed multi-location test data for the artist registration studio selector.

BEGIN;

WITH studio AS (
  INSERT INTO public.studios (
    name,
    normalized_name,
    country,
    country_code,
    state_province,
    city,
    locality,
    street,
    street_number,
    postal_code,
    formatted_address,
    latitude,
    longitude,
    geocoded_at
  )
  VALUES (
    'Claroscuro Laboratorio de Arte',
    'CLAROSCURO LABORATORIO DE ARTE',
    'Argentina',
    'AR',
    'Ciudad Autonoma de Buenos Aires',
    'Buenos Aires',
    'Almagro',
    'Avenida Medrano',
    '852',
    'C1179AAB',
    'Av. Medrano 852, Almagro, C1179AAB CABA, Argentina',
    -34.60920,
    -58.42160,
    timezone('utc', now())
  )
  ON CONFLICT (normalized_name) DO UPDATE SET
    name = EXCLUDED.name
  RETURNING id
),
resolved_studio AS (
  SELECT id FROM studio
  UNION ALL
  SELECT id
  FROM public.studios
  WHERE normalized_name = 'CLAROSCURO LABORATORIO DE ARTE'
  LIMIT 1
),
seed_locations(label, is_primary, sort_order, country, country_code, state_province, city, locality, street, street_number, postal_code, formatted_address, latitude, longitude) AS (
  VALUES
    ('Sede Almagro', true, 0, 'Argentina', 'AR', 'Ciudad Autonoma de Buenos Aires', 'Buenos Aires', 'Almagro', 'Avenida Medrano', '852', 'C1179AAB', 'Av. Medrano 852, Almagro, C1179AAB CABA, Argentina', -34.60920, -58.42160),
    ('Sede Palermo', false, 1, 'Argentina', 'AR', 'Ciudad Autonoma de Buenos Aires', 'Buenos Aires', 'Palermo', 'Gorriti', '4920', 'C1414BJL', 'Gorriti 4920, Palermo, C1414BJL CABA, Argentina', -34.58780, -58.42690),
    ('Sede Colegiales', false, 2, 'Argentina', 'AR', 'Ciudad Autonoma de Buenos Aires', 'Buenos Aires', 'Colegiales', 'Federico Lacroze', '3100', 'C1426CQP', 'Av. Federico Lacroze 3100, Colegiales, C1426CQP CABA, Argentina', -34.57720, -58.45560)
)
INSERT INTO public.studio_locations (
  studio_id,
  label,
  is_primary,
  is_active,
  sort_order,
  country,
  country_code,
  state_province,
  city,
  locality,
  street,
  street_number,
  postal_code,
  formatted_address,
  latitude,
  longitude,
  geocoded_at
)
SELECT
  rs.id,
  sl.label,
  CASE
    WHEN sl.is_primary
      AND NOT EXISTS (
        SELECT 1
        FROM public.studio_locations primary_location
        WHERE primary_location.studio_id = rs.id
          AND primary_location.is_primary = true
      )
    THEN true
    ELSE false
  END,
  true,
  sl.sort_order,
  sl.country,
  sl.country_code,
  sl.state_province,
  sl.city,
  sl.locality,
  sl.street,
  sl.street_number,
  sl.postal_code,
  sl.formatted_address,
  sl.latitude,
  sl.longitude,
  timezone('utc', now())
FROM resolved_studio rs
CROSS JOIN seed_locations sl
WHERE NOT EXISTS (
  SELECT 1
  FROM public.studio_locations existing
  WHERE existing.studio_id = rs.id
    AND existing.label = sl.label
);

UPDATE public.studios s
SET primary_location_id = sl.id
FROM public.studio_locations sl
WHERE sl.studio_id = s.id
  AND sl.is_primary = true
  AND s.normalized_name = 'CLAROSCURO LABORATORIO DE ARTE';

NOTIFY pgrst, 'reload schema';

COMMIT;
