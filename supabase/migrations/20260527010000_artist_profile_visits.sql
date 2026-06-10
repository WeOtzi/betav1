-- Durable public-profile visit tracking used by /api/artist/profile-visit
-- and the artist dashboard visitors map.

BEGIN;

CREATE TABLE IF NOT EXISTS public.artist_profile_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL,
  artist_username text NOT NULL,
  country text,
  city text,
  latitude double precision,
  longitude double precision,
  device_type text,
  os text,
  browser text,
  ip_hash text,
  device_fingerprint text,
  referrer text,
  is_authenticated boolean NOT NULL DEFAULT false,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.artist_profile_visits
  ADD COLUMN IF NOT EXISTS artist_username text;

UPDATE public.artist_profile_visits
SET artist_username = COALESCE(NULLIF(artist_username, ''), artist_id::text)
WHERE artist_username IS NULL OR artist_username = '';

ALTER TABLE public.artist_profile_visits
  ALTER COLUMN artist_username SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artist_profile_visits_latitude_range'
      AND conrelid = 'public.artist_profile_visits'::regclass
  ) THEN
    ALTER TABLE public.artist_profile_visits
      ADD CONSTRAINT artist_profile_visits_latitude_range
      CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artist_profile_visits_longitude_range'
      AND conrelid = 'public.artist_profile_visits'::regclass
  ) THEN
    ALTER TABLE public.artist_profile_visits
      ADD CONSTRAINT artist_profile_visits_longitude_range
      CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS artist_profile_visits_artist_created_idx
  ON public.artist_profile_visits (artist_id, created_at DESC);

CREATE INDEX IF NOT EXISTS artist_profile_visits_username_created_idx
  ON public.artist_profile_visits (artist_username, created_at DESC);

CREATE INDEX IF NOT EXISTS artist_profile_visits_artist_ip_created_idx
  ON public.artist_profile_visits (artist_id, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS artist_profile_visits_artist_device_created_idx
  ON public.artist_profile_visits (artist_id, device_fingerprint, created_at DESC)
  WHERE device_fingerprint IS NOT NULL;

ALTER TABLE public.artist_profile_visits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'artist_profile_visits'
      AND policyname = 'Artists can read own profile visits'
  ) THEN
    CREATE POLICY "Artists can read own profile visits"
      ON public.artist_profile_visits
      FOR SELECT
      TO authenticated
      USING (artist_id = auth.uid());
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.artist_profile_visits_daily
WITH (security_invoker = true)
AS
SELECT
  artist_id,
  artist_username,
  date_trunc('day', created_at)::date AS day,
  country,
  city,
  device_type,
  count(*)::integer AS visits_count,
  count(DISTINCT COALESCE(NULLIF(ip_hash, ''), NULLIF(device_fingerprint, ''), id::text))::integer AS unique_visitors
FROM public.artist_profile_visits
GROUP BY
  artist_id,
  artist_username,
  date_trunc('day', created_at)::date,
  country,
  city,
  device_type;

GRANT SELECT ON public.artist_profile_visits TO authenticated;
GRANT SELECT ON public.artist_profile_visits_daily TO authenticated;
GRANT INSERT, SELECT ON public.artist_profile_visits TO service_role;

COMMIT;
