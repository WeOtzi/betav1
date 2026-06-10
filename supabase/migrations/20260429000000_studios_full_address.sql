-- studios: full structured address + geo coordinates
--
-- Until now studios had only `name`, `normalized_name`, and a free-text
-- `ubicacion`. To draw studios precisely on the /explore map AND give clients
-- "Cómo llegar" directions, we need every component of a postal address plus
-- lat/lng and a Google Place ID for round-tripping with Places autocomplete.
--
-- Independent artists keep their own coordinates on artists_db; the new
-- artists_with_location view (separate migration) coalesces studio→artist.

BEGIN;

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS country            TEXT,
  ADD COLUMN IF NOT EXISTS country_code       TEXT,
  ADD COLUMN IF NOT EXISTS state_province     TEXT,
  ADD COLUMN IF NOT EXISTS city               TEXT,
  ADD COLUMN IF NOT EXISTS locality           TEXT,
  ADD COLUMN IF NOT EXISTS street             TEXT,
  ADD COLUMN IF NOT EXISTS street_number      TEXT,
  ADD COLUMN IF NOT EXISTS unit               TEXT,
  ADD COLUMN IF NOT EXISTS postal_code        TEXT,
  ADD COLUMN IF NOT EXISTS formatted_address  TEXT,
  ADD COLUMN IF NOT EXISTS latitude           DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS google_place_id    TEXT,
  ADD COLUMN IF NOT EXISTS phone              TEXT,
  ADD COLUMN IF NOT EXISTS website            TEXT,
  ADD COLUMN IF NOT EXISTS geocoded_at        TIMESTAMPTZ;

-- Coordinate validity guard. We allow NULL (not yet geocoded) but reject
-- nonsense values that would push a pin to the middle of the ocean.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studios_latitude_range_check'
  ) THEN
    ALTER TABLE public.studios
      ADD CONSTRAINT studios_latitude_range_check
      CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studios_longitude_range_check'
  ) THEN
    ALTER TABLE public.studios
      ADD CONSTRAINT studios_longitude_range_check
      CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'studios_coords_paired_check'
  ) THEN
    ALTER TABLE public.studios
      ADD CONSTRAINT studios_coords_paired_check
      CHECK ((latitude IS NULL) = (longitude IS NULL));
  END IF;
END;
$$;

-- Index for "studios in this country / city" filters that the map uses.
CREATE INDEX IF NOT EXISTS idx_studios_country_city
  ON public.studios (country, city);

-- Index that lets the map quickly skip studios without coordinates.
CREATE INDEX IF NOT EXISTS idx_studios_geocoded
  ON public.studios (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Backfill the new city/country columns from the existing free-text
-- `ubicacion` field so studios that already have "Buenos Aires, Argentina"
-- don't lose that signal. This is best-effort: the seed migration replaces
-- it with structured data.
UPDATE public.studios
SET
  city    = COALESCE(city,    btrim(split_part(ubicacion, ',', 1))),
  country = COALESCE(country, btrim(split_part(ubicacion, ',', 2)))
WHERE ubicacion IS NOT NULL AND btrim(ubicacion) <> '';

NOTIFY pgrst, 'reload schema';

COMMIT;
