-- Verified reviews and public reputation.
-- Reviews are public only after support approval and must be tied to a
-- completed/verifiable business context.

BEGIN;

-- ------------------------------------------------------------
-- Client public profile fields used by reviews/public profiles.
-- clients_db is a legacy dependency in this project, so keep this idempotent.
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS public.clients_db
  ADD COLUMN IF NOT EXISTS public_username TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_public_username_unique
  ON public.clients_db (lower(public_username))
  WHERE public_username IS NOT NULL AND public_username <> '';

-- ------------------------------------------------------------
-- Quotation close-out metadata.
-- `artist_completed` is the artist-side finalization request. The client
-- acceptance is the only normal path to `completed`, unless support resolves
-- the row directly with elevated privileges outside the public UI.
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS public.quotations_db
  ADD COLUMN IF NOT EXISTS dispute_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS artist_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by_client_user_id UUID;

DO $$
BEGIN
  ALTER TABLE public.quotations_db
    ADD CONSTRAINT quotations_db_dispute_status_check
    CHECK (dispute_status IN ('none', 'open', 'resolved'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION fn_quotation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    valid_transitions JSONB := '{
        "pending": ["responded", "expired", "cancelled"],
        "responded": ["client_approved", "client_rejected", "expired"],
        "client_approved": ["in_progress", "cancelled"],
        "in_progress": ["pending", "artist_completed", "cancelled"],
        "artist_completed": ["in_progress", "completed", "cancelled"],
        "en_progreso": ["artist_completed", "cancelled"],
        "client_rejected": ["responded"],
        "completed": [],
        "expired": [],
        "cancelled": []
    }'::JSONB;
    allowed JSONB;
BEGIN
    IF OLD.quote_status IS DISTINCT FROM NEW.quote_status THEN
        IF OLD.quote_status IS NOT NULL AND valid_transitions ? OLD.quote_status THEN
            allowed := valid_transitions -> OLD.quote_status;
            IF NOT allowed @> to_jsonb(NEW.quote_status) THEN
                RAISE EXCEPTION 'Invalid status transition: % -> %. Allowed: %',
                    OLD.quote_status, NEW.quote_status, allowed;
            END IF;
        END IF;

        IF NEW.quote_status = 'artist_completed' THEN
            NEW.artist_completed_at := COALESCE(NEW.artist_completed_at, timezone('utc', now()));
        END IF;

        IF NEW.quote_status = 'completed' THEN
            NEW.client_completed_at := COALESCE(NEW.client_completed_at, timezone('utc', now()));
        END IF;

        INSERT INTO quotation_status_history (quotation_id, quote_id, old_status, new_status, changed_by)
        VALUES (NEW.id, NEW.quote_id, OLD.quote_status, NEW.quote_status,
                current_setting('request.jwt.claims', true)::json->>'sub');

        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- Reviews.
-- reviewer/reviewee ids are Supabase Auth user ids for people. Studios use
-- studios.id as the reviewee_user_id/reviewer_user_id when reviewee_type or
-- reviewer_type is `studio`.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verified_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  context_type TEXT NOT NULL
    CHECK (context_type IN ('quotation', 'studio_job', 'studio_membership', 'studio_spot_application')),
  quotation_id INTEGER REFERENCES public.quotations_db(id) ON DELETE RESTRICT,
  studio_job_id UUID REFERENCES public.studio_jobs_log(id) ON DELETE RESTRICT,
  studio_membership_id UUID REFERENCES public.studio_artist_memberships(id) ON DELETE RESTRICT,
  studio_spot_application_id UUID REFERENCES public.studio_spot_applications(id) ON DELETE RESTRICT,
  context_id TEXT GENERATED ALWAYS AS (
    COALESCE(quotation_id::TEXT, studio_job_id::TEXT, studio_membership_id::TEXT, studio_spot_application_id::TEXT)
  ) STORED,

  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('client', 'artist', 'studio')),
  reviewer_user_id UUID NOT NULL,
  reviewer_display_name TEXT NOT NULL,
  reviewer_username TEXT,
  reviewer_country TEXT,
  reviewer_avatar_url TEXT,

  reviewee_type TEXT NOT NULL CHECK (reviewee_type IN ('client', 'artist', 'studio')),
  reviewee_user_id UUID NOT NULL,
  reviewee_display_name TEXT,

  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 3 AND 2000),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  photo_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  response_comment TEXT,
  response_by_user_id UUID,
  response_status TEXT NOT NULL DEFAULT 'none'
    CHECK (response_status IN ('none', 'pending', 'approved', 'hidden')),
  response_created_at TIMESTAMPTZ,
  response_updated_at TIMESTAMPTZ,

  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'hidden')),
  moderation_reason TEXT,
  approved_at TIMESTAMPTZ,
  approved_by_user_id UUID,
  highlighted_at TIMESTAMPTZ,
  is_public BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT verified_reviews_one_context CHECK (
       (context_type = 'quotation' AND quotation_id IS NOT NULL AND studio_job_id IS NULL AND studio_membership_id IS NULL AND studio_spot_application_id IS NULL)
    OR (context_type = 'studio_job' AND quotation_id IS NULL AND studio_job_id IS NOT NULL AND studio_membership_id IS NULL AND studio_spot_application_id IS NULL)
    OR (context_type = 'studio_membership' AND quotation_id IS NULL AND studio_job_id IS NULL AND studio_membership_id IS NOT NULL AND studio_spot_application_id IS NULL)
    OR (context_type = 'studio_spot_application' AND quotation_id IS NULL AND studio_job_id IS NULL AND studio_membership_id IS NULL AND studio_spot_application_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_verified_reviews_unique_context_pair
  ON public.verified_reviews (context_type, context_id, reviewer_type, reviewer_user_id, reviewee_type, reviewee_user_id);

CREATE INDEX IF NOT EXISTS idx_verified_reviews_public_feed
  ON public.verified_reviews (reviewee_type, reviewee_user_id, created_at DESC)
  WHERE moderation_status = 'approved' AND is_public = true;

CREATE INDEX IF NOT EXISTS idx_verified_reviews_public_rating
  ON public.verified_reviews (reviewee_type, reviewee_user_id, rating)
  WHERE moderation_status = 'approved' AND is_public = true;

CREATE INDEX IF NOT EXISTS idx_verified_reviews_tags
  ON public.verified_reviews USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_verified_reviews_moderation
  ON public.verified_reviews (moderation_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_verified_reviews_is_support()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.support_users_db su
    WHERE su.user_id = (SELECT auth.uid())
      AND su.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_verified_reviews_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q RECORD;
  j RECORD;
  m RECORD;
  a RECORD;
  is_support BOOLEAN;
BEGIN
  is_support := public.fn_verified_reviews_is_support();

  NEW.updated_at := timezone('utc', now());

  IF NEW.moderation_status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := timezone('utc', now());
    NEW.approved_by_user_id := COALESCE(NEW.approved_by_user_id, (SELECT auth.uid()));
  END IF;

  IF NEW.response_comment IS NOT NULL AND NEW.response_status = 'none' THEN
    NEW.response_status := 'pending';
    NEW.response_created_at := COALESCE(NEW.response_created_at, timezone('utc', now()));
  END IF;

  IF NEW.context_type = 'quotation' THEN
    SELECT id, quote_status, dispute_status, artist_id, client_user_id
    INTO q
    FROM public.quotations_db
    WHERE id = NEW.quotation_id;

    IF NOT FOUND OR q.quote_status <> 'completed' OR COALESCE(q.dispute_status, 'none') <> 'none' THEN
      RAISE EXCEPTION 'Reviews require a completed quotation without open disputes';
    END IF;

    IF NEW.reviewer_type = 'client' AND q.client_user_id IS DISTINCT FROM NEW.reviewer_user_id THEN
      RAISE EXCEPTION 'Client reviewer does not own this quotation';
    END IF;

    IF NEW.reviewer_type = 'artist' AND q.artist_id IS DISTINCT FROM NEW.reviewer_user_id THEN
      RAISE EXCEPTION 'Artist reviewer does not own this quotation';
    END IF;

    IF NEW.reviewee_type = 'artist' AND q.artist_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Artist reviewee does not match this quotation';
    END IF;

    IF NEW.reviewee_type = 'client' AND q.client_user_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Client reviewee does not match this quotation';
    END IF;
  ELSIF NEW.context_type = 'studio_job' THEN
    SELECT id, status, studio_id, artist_user_id, client_user_id
    INTO j
    FROM public.studio_jobs_log
    WHERE id = NEW.studio_job_id;

    IF NOT FOUND OR j.status <> 'completed' THEN
      RAISE EXCEPTION 'Reviews require a completed studio job';
    END IF;

    IF NEW.reviewee_type = 'studio' AND j.studio_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Studio reviewee does not match this job';
    END IF;

    IF NEW.reviewee_type = 'artist' AND j.artist_user_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Artist reviewee does not match this job';
    END IF;
  ELSIF NEW.context_type = 'studio_membership' THEN
    SELECT id, status, studio_id, artist_user_id, ended_at
    INTO m
    FROM public.studio_artist_memberships
    WHERE id = NEW.studio_membership_id;

    IF NOT FOUND OR NOT (m.status = 'ended' OR (m.ended_at IS NOT NULL AND m.ended_at <= timezone('utc', now()))) THEN
      RAISE EXCEPTION 'Reviews require an ended studio membership';
    END IF;

    IF NEW.reviewee_type = 'studio' AND m.studio_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Studio reviewee does not match this membership';
    END IF;

    IF NEW.reviewee_type = 'artist' AND m.artist_user_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Artist reviewee does not match this membership';
    END IF;

    IF NEW.reviewer_type = 'studio' AND m.studio_id IS DISTINCT FROM NEW.reviewer_user_id THEN
      RAISE EXCEPTION 'Studio reviewer does not match this membership';
    END IF;

    IF NEW.reviewer_type = 'artist' AND m.artist_user_id IS DISTINCT FROM NEW.reviewer_user_id THEN
      RAISE EXCEPTION 'Artist reviewer does not match this membership';
    END IF;
  ELSIF NEW.context_type = 'studio_spot_application' THEN
    SELECT ssa.id, ssa.status, ssa.artist_user_id, ss.studio_id, ss.end_date
    INTO a
    FROM public.studio_spot_applications ssa
    JOIN public.studio_spots ss ON ss.id = ssa.spot_id
    WHERE ssa.id = NEW.studio_spot_application_id;

    IF NOT FOUND OR a.status <> 'accepted' OR a.end_date IS NULL OR a.end_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Reviews require a completed accepted studio spot';
    END IF;

    IF NEW.reviewee_type = 'studio' AND a.studio_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Studio reviewee does not match this spot';
    END IF;

    IF NEW.reviewee_type = 'artist' AND a.artist_user_id IS DISTINCT FROM NEW.reviewee_user_id THEN
      RAISE EXCEPTION 'Artist reviewee does not match this spot';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NOT is_support THEN
    NEW.moderation_status := 'pending';
    NEW.approved_at := NULL;
    NEW.approved_by_user_id := NULL;
    NEW.highlighted_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_verified_reviews_validate ON public.verified_reviews;
CREATE TRIGGER trigger_verified_reviews_validate
  BEFORE INSERT OR UPDATE ON public.verified_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_verified_reviews_validate();

ALTER TABLE public.verified_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verified_reviews_public_read_approved" ON public.verified_reviews;
CREATE POLICY "verified_reviews_public_read_approved"
  ON public.verified_reviews FOR SELECT
  TO anon, authenticated
  USING (moderation_status = 'approved' AND is_public = true);

DROP POLICY IF EXISTS "verified_reviews_insert_own_pending" ON public.verified_reviews;
CREATE POLICY "verified_reviews_insert_own_pending"
  ON public.verified_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    reviewer_user_id = (SELECT auth.uid())
    AND moderation_status = 'pending'
  );

DROP POLICY IF EXISTS "verified_reviews_support_select_all" ON public.verified_reviews;
CREATE POLICY "verified_reviews_support_select_all"
  ON public.verified_reviews FOR SELECT
  TO authenticated
  USING (public.fn_verified_reviews_is_support());

DROP POLICY IF EXISTS "verified_reviews_support_update_all" ON public.verified_reviews;
CREATE POLICY "verified_reviews_support_update_all"
  ON public.verified_reviews FOR UPDATE
  TO authenticated
  USING (public.fn_verified_reviews_is_support())
  WITH CHECK (public.fn_verified_reviews_is_support());

DROP POLICY IF EXISTS "verified_reviews_author_response_pending" ON public.verified_reviews;
CREATE POLICY "verified_reviews_author_response_pending"
  ON public.verified_reviews FOR UPDATE
  TO authenticated
  USING (
    moderation_status = 'approved'
    AND (
      reviewee_user_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.studios s
        WHERE s.id = verified_reviews.reviewee_user_id
          AND s.user_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    moderation_status = 'approved'
    AND (
      reviewee_user_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.studios s
        WHERE s.id = verified_reviews.reviewee_user_id
          AND s.user_id = (SELECT auth.uid())
      )
    )
    AND response_status IN ('pending', 'approved', 'hidden')
  );

CREATE OR REPLACE VIEW public.public_review_summary
WITH (security_invoker = on) AS
SELECT
  reviewee_type,
  reviewee_user_id,
  COUNT(*)::integer AS review_count,
  ROUND(AVG(rating)::numeric, 2) AS average_rating,
  COUNT(*) FILTER (WHERE rating = 5)::integer AS five_star_count,
  COUNT(*) FILTER (WHERE rating = 4)::integer AS four_star_count,
  COUNT(*) FILTER (WHERE rating = 3)::integer AS three_star_count,
  COUNT(*) FILTER (WHERE rating = 2)::integer AS two_star_count,
  COUNT(*) FILTER (WHERE rating = 1)::integer AS one_star_count
FROM public.verified_reviews
WHERE moderation_status = 'approved' AND is_public = true
GROUP BY reviewee_type, reviewee_user_id;

CREATE OR REPLACE VIEW public.public_review_tag_counts
WITH (security_invoker = on) AS
SELECT
  reviewee_type,
  reviewee_user_id,
  tag,
  COUNT(*)::integer AS tag_count
FROM public.verified_reviews
CROSS JOIN LATERAL unnest(tags) AS tag
WHERE moderation_status = 'approved' AND is_public = true
GROUP BY reviewee_type, reviewee_user_id, tag;

DO $$
BEGIN
  IF to_regclass('public.clients_db') IS NOT NULL THEN
    EXECUTE $view$
      CREATE OR REPLACE VIEW public.client_public_profiles
      WITH (security_invoker = on) AS
      SELECT
        user_id,
        COALESCE(NULLIF(public_username, ''), NULLIF(full_name, ''), 'Cliente') AS public_username,
        profile_picture,
        country,
        city_residence,
        public_profile_enabled,
        profile_completed_at,
        created_at
      FROM public.clients_db
      WHERE public_profile_enabled = true
    $view$;
  END IF;
END $$;

GRANT SELECT ON public.verified_reviews TO anon, authenticated;
GRANT INSERT, UPDATE ON public.verified_reviews TO authenticated;
GRANT ALL ON public.verified_reviews TO service_role;
GRANT SELECT ON public.public_review_summary TO anon, authenticated;
GRANT SELECT ON public.public_review_tag_counts TO anon, authenticated;
DO $$
BEGIN
  IF to_regclass('public.client_public_profiles') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON public.client_public_profiles TO anon, authenticated';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
