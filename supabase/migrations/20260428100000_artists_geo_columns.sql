-- Add geo coordinates to artists_db so /explore map can show pins without re-geocoding.
-- Strategy: hybrid progressive. No backfill here; the frontend geocodes on demand
-- (city + country) and the backend persists the result.

BEGIN;

ALTER TABLE public.artists_db
    ADD COLUMN IF NOT EXISTS latitude         DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS geocoded_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS geocoded_address TEXT;

CREATE INDEX IF NOT EXISTS idx_artists_geo
    ON public.artists_db (latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON COLUMN public.artists_db.latitude IS 'Latitude geocoded from city+country. Filled by /api/artists/geocode endpoint.';
COMMENT ON COLUMN public.artists_db.longitude IS 'Longitude geocoded from city+country. Filled by /api/artists/geocode endpoint.';
COMMENT ON COLUMN public.artists_db.geocoded_at IS 'Timestamp when coordinates were last persisted.';
COMMENT ON COLUMN public.artists_db.geocoded_address IS 'Formatted address returned by Google Geocoder for traceability.';

NOTIFY pgrst, 'reload schema';

COMMIT;
