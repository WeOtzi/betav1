-- artists_with_location: single source of truth for "where is this artist?"
--
-- The /explore map and any "Cómo llegar" surface should not have to know
-- whether an artist works at a studio or independently. This view picks
-- the studio address when work_type ∈ {'studio', 'both'} AND studio_id is
-- set; otherwise it falls back to the artist's own address fields.
--
-- The `location_source` column is exposed so the UI can render a tiny
-- badge ("Estudio: Bang Bang NYC" vs "Independiente").

BEGIN;

DROP VIEW IF EXISTS public.artists_with_location;

CREATE VIEW public.artists_with_location AS
SELECT
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

  -- Resolved location: studio when affiliated, artist's own fields otherwise.
  CASE
    WHEN a.studio_id IS NOT NULL AND s.id IS NOT NULL THEN 'studio'
    ELSE 'independent'
  END AS location_source,

  COALESCE(s.name, NULL)                            AS studio_name,
  COALESCE(s.country,           a.country)          AS country,
  COALESCE(s.country_code,      a.country_code)     AS country_code,
  COALESCE(s.state_province,    a.state_province)   AS state_province,
  COALESCE(s.city,              a.city)             AS city,
  COALESCE(s.locality,          a.locality)         AS locality,
  COALESCE(s.street,            a.street)           AS street,
  COALESCE(s.street_number,     a.street_number)    AS street_number,
  COALESCE(s.unit,              a.unit)             AS unit,
  COALESCE(s.postal_code,       a.postal_code)      AS postal_code,
  COALESCE(s.formatted_address, a.formatted_address, a.ubicacion) AS formatted_address,
  COALESCE(s.latitude,          a.latitude)         AS latitude,
  COALESCE(s.longitude,         a.longitude)        AS longitude,
  COALESCE(s.google_place_id,   a.google_place_id)  AS google_place_id,
  s.phone                                           AS studio_phone,
  s.website                                         AS studio_website,
  COALESCE(s.geocoded_at,       a.geocoded_at)      AS geocoded_at
FROM public.artists_db a
LEFT JOIN public.studios s ON (
  a.studio_id = s.id
  AND a.work_type IN ('studio', 'both')
);

COMMENT ON VIEW public.artists_with_location IS
  'Single source of truth for artist location. Falls back from studio to '
  'artist''s own address based on work_type. Used by /explore map and '
  'any "Cómo llegar" surface.';

NOTIFY pgrst, 'reload schema';

COMMIT;
