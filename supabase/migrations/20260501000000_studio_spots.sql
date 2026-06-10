-- Studio spots: open positions a studio is recruiting for.
--
-- Forked from the existing `job_board_*` pattern but residency-specific:
-- a spot is "we have a chair available for a resident/itinerant/guest", not
-- "we want this specific tattoo done". An application is an artist asking
-- for that chair; the studio reviews and accepts/rejects.
--
-- Acceptance side-effect (handled in app code, not in this migration): on
-- accept we ALSO insert a row in studio_artist_memberships so the artist
-- shows up in the studio's roster and the artist sees the studio under
-- their `artist_tattoo_locations`.

BEGIN;

-- ============================================================
-- studio_spots
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_spots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id            UUID NOT NULL REFERENCES public.studios(id)         ON DELETE CASCADE,
  location_id          UUID          REFERENCES public.studio_locations(id) ON DELETE SET NULL,

  -- What the spot is about
  title                TEXT NOT NULL,
  kind                 TEXT NOT NULL DEFAULT 'guest_spot'
    CHECK (kind IN ('resident', 'itinerant', 'guest_spot')),
  description          TEXT,
  styles_wanted        TEXT[]    NOT NULL DEFAULT ARRAY[]::TEXT[],
  experience_min_years INTEGER,
  language_requirements TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  includes_housing     BOOLEAN   NOT NULL DEFAULT false,

  -- Compensation (any/all may be null — depends on the deal)
  revenue_split_pct    NUMERIC(5,2)
    CHECK (revenue_split_pct IS NULL OR (revenue_split_pct >= 0 AND revenue_split_pct <= 100)),
  stipend_amount       NUMERIC(10,2),
  stipend_currency     TEXT,

  -- Timeline
  start_date           DATE,
  end_date             DATE,
  weeks_minimum        INTEGER,
  weeks_maximum        INTEGER,

  -- Lifecycle
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'filled', 'closed', 'expired')),
  max_applications     INTEGER,
  application_count    INTEGER NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ,

  cover_image          TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT studio_spots_dates_check
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT studio_spots_weeks_check
    CHECK (weeks_maximum IS NULL OR weeks_minimum IS NULL OR weeks_maximum >= weeks_minimum)
);

CREATE INDEX IF NOT EXISTS idx_studio_spots_studio   ON public.studio_spots (studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_spots_status   ON public.studio_spots (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_studio_spots_kind     ON public.studio_spots (kind);
CREATE INDEX IF NOT EXISTS idx_studio_spots_styles   ON public.studio_spots USING GIN (styles_wanted);
CREATE INDEX IF NOT EXISTS idx_studio_spots_location ON public.studio_spots (location_id) WHERE location_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_studio_spots_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;

DROP TRIGGER IF EXISTS trigger_studio_spots_updated_at ON public.studio_spots;
CREATE TRIGGER trigger_studio_spots_updated_at
  BEFORE UPDATE ON public.studio_spots
  FOR EACH ROW EXECUTE FUNCTION public.set_studio_spots_updated_at();

-- ============================================================
-- studio_spot_applications
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_spot_applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id             UUID NOT NULL REFERENCES public.studio_spots(id)        ON DELETE CASCADE,
  artist_user_id      UUID NOT NULL REFERENCES public.artists_db(user_id)     ON DELETE CASCADE,

  message             TEXT,
  portfolio_url       TEXT,
  requested_dates     DATERANGE,

  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'viewed', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  decided_at          TIMESTAMPTZ,
  decided_by_user_id  UUID,

  CONSTRAINT studio_spot_applications_one_per_artist
    UNIQUE (spot_id, artist_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ssa_spot   ON public.studio_spot_applications (spot_id);
CREATE INDEX IF NOT EXISTS idx_ssa_artist ON public.studio_spot_applications (artist_user_id);
CREATE INDEX IF NOT EXISTS idx_ssa_status ON public.studio_spot_applications (status);

-- Maintain studio_spots.application_count via trigger.
CREATE OR REPLACE FUNCTION public.bump_studio_spot_app_count()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.studio_spots SET application_count = application_count + 1
    WHERE id = NEW.spot_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.studio_spots SET application_count = GREATEST(application_count - 1, 0)
    WHERE id = OLD.spot_id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_ssa_count ON public.studio_spot_applications;
CREATE TRIGGER trigger_ssa_count
  AFTER INSERT OR DELETE ON public.studio_spot_applications
  FOR EACH ROW EXECUTE FUNCTION public.bump_studio_spot_app_count();

-- ============================================================
-- studio_spot_attachments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_spot_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id       UUID NOT NULL REFERENCES public.studio_spots(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_name     TEXT,
  mime_type     TEXT,
  file_size     BIGINT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_ssat_spot ON public.studio_spot_attachments (spot_id);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.studio_spots             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_spot_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_spot_attachments  ENABLE ROW LEVEL SECURITY;

-- studio_spots: open spots are public; the studio owner manages their own.
DROP POLICY IF EXISTS "spots_public_select_open"   ON public.studio_spots;
DROP POLICY IF EXISTS "spots_owner_full"           ON public.studio_spots;
CREATE POLICY "spots_public_select_open"
  ON public.studio_spots FOR SELECT
  USING (status = 'open');
CREATE POLICY "spots_owner_full"
  ON public.studio_spots FOR ALL
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studios s
      WHERE s.id = studio_id AND (
        s.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studios s
      WHERE s.id = studio_id AND (
        s.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
      )
    )
  );

-- studio_spot_applications: artist sees their own; studio owner sees apps to their spots.
DROP POLICY IF EXISTS "ssa_artist_or_studio_select" ON public.studio_spot_applications;
DROP POLICY IF EXISTS "ssa_artist_insert"           ON public.studio_spot_applications;
DROP POLICY IF EXISTS "ssa_artist_or_studio_update" ON public.studio_spot_applications;
CREATE POLICY "ssa_artist_or_studio_select"
  ON public.studio_spot_applications FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      auth.uid() = artist_user_id
      OR EXISTS (
        SELECT 1 FROM public.studio_spots sp
        JOIN public.studios s ON s.id = sp.studio_id
        WHERE sp.id = spot_id AND s.user_id = auth.uid()
      )
      OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
    )
  );
CREATE POLICY "ssa_artist_insert"
  ON public.studio_spot_applications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = artist_user_id);
CREATE POLICY "ssa_artist_or_studio_update"
  ON public.studio_spot_applications FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND (
      auth.uid() = artist_user_id
      OR EXISTS (
        SELECT 1 FROM public.studio_spots sp
        JOIN public.studios s ON s.id = sp.studio_id
        WHERE sp.id = spot_id AND s.user_id = auth.uid()
      )
      OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
    )
  );

-- attachments: public can read for open spots; studio manages.
DROP POLICY IF EXISTS "ssat_public_select" ON public.studio_spot_attachments;
DROP POLICY IF EXISTS "ssat_studio_full"   ON public.studio_spot_attachments;
CREATE POLICY "ssat_public_select"
  ON public.studio_spot_attachments FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.studio_spots sp WHERE sp.id = spot_id AND sp.status = 'open')
  );
CREATE POLICY "ssat_studio_full"
  ON public.studio_spot_attachments FOR ALL
  USING (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studio_spots sp
      JOIN public.studios s ON s.id = sp.studio_id
      WHERE sp.id = spot_id AND (
        s.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.studio_spots sp
      JOIN public.studios s ON s.id = sp.studio_id
      WHERE sp.id = spot_id AND (
        s.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
