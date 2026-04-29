-- Dynamic pricing for artists (opt-in)
-- Adds toggle + computed factor + breakdown + floor override on artists_db
-- Adds artist_dynamic_pricing_log for cron audit
-- Adds get_artist_avg_rating(p_user_id) helper used by the cron compute step

BEGIN;

ALTER TABLE public.artists_db
  ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dynamic_pricing_factor        NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS dynamic_pricing_breakdown     JSONB,
  ADD COLUMN IF NOT EXISTS dynamic_pricing_calculated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dynamic_pricing_floor_amount  NUMERIC(14,2);

ALTER TABLE public.artists_db
  ADD CONSTRAINT artists_db_dynamic_pricing_factor_range
  CHECK (dynamic_pricing_factor IS NULL OR (dynamic_pricing_factor >= 0.80 AND dynamic_pricing_factor <= 1.40));

CREATE INDEX IF NOT EXISTS idx_artists_db_dynamic_pricing_enabled
  ON public.artists_db (dynamic_pricing_enabled)
  WHERE dynamic_pricing_enabled = TRUE;

CREATE TABLE IF NOT EXISTS public.artist_dynamic_pricing_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_user_id  UUID NOT NULL REFERENCES public.artists_db(user_id) ON DELETE CASCADE,
  factor_applied  NUMERIC(4,3) NOT NULL,
  breakdown       JSONB NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_artist_dynamic_pricing_log_artist_time
  ON public.artist_dynamic_pricing_log (artist_user_id, computed_at DESC);

CREATE OR REPLACE FUNCTION public.get_artist_avg_rating(p_user_id UUID)
RETURNS TABLE(avg_rating NUMERIC, n_ratings INTEGER)
LANGUAGE sql STABLE AS $$
  SELECT
    ROUND(AVG(qs.rating_stars)::NUMERIC, 2) AS avg_rating,
    COUNT(*)::INTEGER AS n_ratings
  FROM public.quotation_surveys qs
  JOIN public.quotations_db qd ON qd.id = qs.quotation_id
  WHERE qd.artist_id = p_user_id
    AND qs.rating_stars IS NOT NULL;
$$;

COMMIT;
