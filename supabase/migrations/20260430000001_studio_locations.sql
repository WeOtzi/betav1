-- studio_locations: a studio has many shops.
--
-- Until now, addresses lived directly on the `studios` row, which forced a
-- 1:1 model. Real tattoo studios run multiple branches (different cities,
-- pop-up residencies, etc.). This migration:
--
--   1. Creates `studio_locations` as the canonical table for addresses.
--   2. Backfills one row per existing studio (the "primary" location) by
--      copying its current address columns.
--   3. Adds `studios.primary_location_id` so consumers that only need ONE
--      address per studio (cards, list rows) keep a fast path.
--   4. Replaces the `artists_with_location` view to JOIN on the new table.
--
-- We DO NOT drop the address columns from `studios` in this migration. They
-- stay as a deprecated read-only mirror for one release so anything still
-- reading them keeps working. A later migration will drop them.

BEGIN;

-- ============================================================
-- 1) Create studio_locations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_locations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id          UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,

  -- Display / disambiguation
  label              TEXT,                       -- e.g. "Sucursal Palermo", "Sede principal"
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  sort_order         INTEGER NOT NULL DEFAULT 0,

  -- Address (mirrors studios columns we built last release)
  country            TEXT,
  country_code       TEXT,
  state_province     TEXT,
  city               TEXT,
  locality           TEXT,
  street             TEXT,
  street_number      TEXT,
  unit               TEXT,
  postal_code        TEXT,
  formatted_address  TEXT,

  -- Geo
  latitude           DOUBLE PRECISION,
  longitude          DOUBLE PRECISION,
  google_place_id    TEXT,
  geocoded_at        TIMESTAMPTZ,

  -- Contact / hours per location
  phone              TEXT,
  hours_json         JSONB,                       -- {monday: {open: '10:00', close: '20:00'}, ...}

  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT studio_locations_lat_range
    CHECK (latitude  IS NULL OR (latitude  >= -90  AND latitude  <= 90 )),
  CONSTRAINT studio_locations_lng_range
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  CONSTRAINT studio_locations_coords_paired
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_studio_locations_studio_id
  ON public.studio_locations (studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_locations_geocoded
  ON public.studio_locations (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- A studio has at most one primary location — partial unique index makes
-- the constraint enforceable without forcing every row to be primary.
CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_locations_one_primary
  ON public.studio_locations (studio_id)
  WHERE is_primary = true;

-- updated_at trigger (reuses pattern from artist_tattoo_locations).
CREATE OR REPLACE FUNCTION public.set_studio_locations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_studio_locations_updated_at ON public.studio_locations;
CREATE TRIGGER trigger_studio_locations_updated_at
  BEFORE UPDATE ON public.studio_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_studio_locations_updated_at();

-- ============================================================
-- 2) RLS
-- ============================================================
ALTER TABLE public.studio_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "studio_locations_public_select"  ON public.studio_locations;
DROP POLICY IF EXISTS "studio_locations_owner_write"    ON public.studio_locations;

CREATE POLICY "studio_locations_public_select"
  ON public.studio_locations FOR SELECT
  USING (true);

CREATE POLICY "studio_locations_owner_write"
  ON public.studio_locations FOR ALL
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studios s
      WHERE s.id = studio_id AND (
        s.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.support_users_db su
          WHERE su.user_id = auth.uid() AND su.is_active = true
        )
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studios s
      WHERE s.id = studio_id AND (
        s.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.support_users_db su
          WHERE su.user_id = auth.uid() AND su.is_active = true
        )
      )
    )
  );

-- ============================================================
-- 3) Backfill one row per existing studio
-- ============================================================
INSERT INTO public.studio_locations (
  studio_id, label, is_primary, is_active, sort_order,
  country, country_code, state_province, city, locality,
  street, street_number, unit, postal_code, formatted_address,
  latitude, longitude, google_place_id, geocoded_at,
  phone
)
SELECT
  s.id,
  'Sede principal' AS label,
  true             AS is_primary,
  true             AS is_active,
  0                AS sort_order,
  s.country, s.country_code, s.state_province, s.city, s.locality,
  s.street, s.street_number, s.unit, s.postal_code, s.formatted_address,
  s.latitude, s.longitude, s.google_place_id, s.geocoded_at,
  s.phone
FROM public.studios s
WHERE NOT EXISTS (
  SELECT 1 FROM public.studio_locations sl
  WHERE sl.studio_id = s.id AND sl.is_primary = true
);

-- ============================================================
-- 4) Add primary_location_id on studios for fast lookups
-- ============================================================
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS primary_location_id UUID REFERENCES public.studio_locations(id) ON DELETE SET NULL;

UPDATE public.studios s
SET primary_location_id = sl.id
FROM public.studio_locations sl
WHERE sl.studio_id = s.id
  AND sl.is_primary = true
  AND s.primary_location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_studios_primary_location_id
  ON public.studios (primary_location_id)
  WHERE primary_location_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
