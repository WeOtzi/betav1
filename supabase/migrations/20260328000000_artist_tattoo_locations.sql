-- Multi-location tattoo schedule for artists
-- Supports multiple current studios and multiple upcoming guest spots.

BEGIN;

CREATE TABLE IF NOT EXISTS public.artist_tattoo_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_user_id  UUID NOT NULL REFERENCES public.artists_db(user_id) ON DELETE CASCADE,
  period_type     TEXT NOT NULL CHECK (period_type IN ('current', 'upcoming')),
  studio_id       UUID REFERENCES public.studios(id) ON DELETE SET NULL,
  studio_name     TEXT NOT NULL,
  city            TEXT,
  agenda_status   TEXT NOT NULL DEFAULT 'open' CHECK (agenda_status IN ('open', 'closed')),
  start_date      DATE,
  end_date        DATE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT artist_tattoo_locations_studio_name_not_empty
    CHECK (char_length(btrim(studio_name)) > 0),

  CONSTRAINT artist_tattoo_locations_unique_slot
    UNIQUE (artist_user_id, period_type, sort_order),

  CONSTRAINT artist_tattoo_locations_period_dates_check
    CHECK (
      (period_type = 'current' AND start_date IS NULL AND end_date IS NULL)
      OR
      (period_type = 'upcoming' AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
    )
);

CREATE INDEX IF NOT EXISTS idx_artist_tattoo_locations_artist_period
  ON public.artist_tattoo_locations (artist_user_id, period_type, sort_order, start_date);

CREATE INDEX IF NOT EXISTS idx_artist_tattoo_locations_upcoming_dates
  ON public.artist_tattoo_locations (start_date, end_date)
  WHERE period_type = 'upcoming';

CREATE INDEX IF NOT EXISTS idx_artist_tattoo_locations_studio_id
  ON public.artist_tattoo_locations (studio_id)
  WHERE studio_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_artist_tattoo_locations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_artist_tattoo_locations_updated_at ON public.artist_tattoo_locations;
CREATE TRIGGER trigger_artist_tattoo_locations_updated_at
  BEFORE UPDATE ON public.artist_tattoo_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_artist_tattoo_locations_updated_at();

ALTER TABLE public.artist_tattoo_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view tattoo locations" ON public.artist_tattoo_locations;
CREATE POLICY "Public can view tattoo locations"
  ON public.artist_tattoo_locations
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Artists can insert own tattoo locations" ON public.artist_tattoo_locations;
CREATE POLICY "Artists can insert own tattoo locations"
  ON public.artist_tattoo_locations
  FOR INSERT
  WITH CHECK (auth.uid() = artist_user_id OR is_support_user());

DROP POLICY IF EXISTS "Artists can update own tattoo locations" ON public.artist_tattoo_locations;
CREATE POLICY "Artists can update own tattoo locations"
  ON public.artist_tattoo_locations
  FOR UPDATE
  USING (auth.uid() = artist_user_id OR is_support_user())
  WITH CHECK (auth.uid() = artist_user_id OR is_support_user());

DROP POLICY IF EXISTS "Artists can delete own tattoo locations" ON public.artist_tattoo_locations;
CREATE POLICY "Artists can delete own tattoo locations"
  ON public.artist_tattoo_locations
  FOR DELETE
  USING (auth.uid() = artist_user_id OR is_support_user());

-- Backfill current studio where legacy data exists.
INSERT INTO public.artist_tattoo_locations (
  artist_user_id,
  period_type,
  studio_id,
  studio_name,
  city,
  agenda_status,
  sort_order
)
SELECT
  a.user_id,
  'current',
  a.studio_id,
  btrim(a.estudios),
  a.city,
  'open',
  0
FROM public.artists_db a
WHERE a.estudios IS NOT NULL
  AND btrim(a.estudios) <> ''
  AND a.estudios <> 'Sin estudio/Independiente'
  AND NOT EXISTS (
    SELECT 1
    FROM public.artist_tattoo_locations atl
    WHERE atl.artist_user_id = a.user_id
      AND atl.period_type = 'current'
      AND atl.sort_order = 0
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
