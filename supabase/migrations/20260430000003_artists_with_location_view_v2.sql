-- artists_with_location view, v2.
--
-- v1 (the version we shipped last session) JOINed on `studios` directly and
-- read s.country, s.city, s.latitude, etc. Now that addresses live in
-- `studio_locations`, the JOIN target moves and we read from sl.* instead.
--
-- For backwards compat we keep the same column names (`country`, `city`,
-- `latitude`, etc.) so the /explore map and any other consumer doesn't
-- need code changes.
--
-- The location chosen is the studio's primary_location_id. Multi-location
-- artist resolution (which exact branch is this artist at?) will happen
-- in Phase B+ via studio_artist_memberships.location_id.

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

  CASE
    WHEN a.studio_id IS NOT NULL AND s.id IS NOT NULL THEN 'studio'
    ELSE 'independent'
  END AS location_source,

  s.name                                            AS studio_name,
  s.slug                                            AS studio_slug,
  COALESCE(sl.country,           a.country)         AS country,
  COALESCE(sl.country_code,      a.country_code)    AS country_code,
  COALESCE(sl.state_province,    a.state_province)  AS state_province,
  COALESCE(sl.city,              a.city)            AS city,
  COALESCE(sl.locality,          a.locality)        AS locality,
  COALESCE(sl.street,            a.street)          AS street,
  COALESCE(sl.street_number,     a.street_number)   AS street_number,
  COALESCE(sl.unit,              a.unit)            AS unit,
  COALESCE(sl.postal_code,       a.postal_code)     AS postal_code,
  COALESCE(sl.formatted_address, a.formatted_address, a.ubicacion) AS formatted_address,
  COALESCE(sl.latitude,          a.latitude)        AS latitude,
  COALESCE(sl.longitude,         a.longitude)       AS longitude,
  COALESCE(sl.google_place_id,   a.google_place_id) AS google_place_id,
  s.contact_phone                                   AS studio_phone,
  s.instagram                                       AS studio_instagram,
  COALESCE(sl.geocoded_at,       a.geocoded_at)     AS geocoded_at
FROM public.artists_db a
LEFT JOIN public.studios s
  ON  a.studio_id = s.id
  AND a.work_type IN ('studio', 'both')
LEFT JOIN public.studio_locations sl
  ON sl.id = s.primary_location_id;

COMMENT ON VIEW public.artists_with_location IS
  'Single source of truth for artist location. v2 JOINs on studio_locations '
  '(via studios.primary_location_id) instead of reading legacy address '
  'columns directly off studios. Falls back to artists_db own address fields '
  'when the artist is independent.';

NOTIFY pgrst, 'reload schema';

COMMIT;
