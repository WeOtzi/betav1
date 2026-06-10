-- Hardening for verified reviews after remote advisor checks.
-- Keep helper functions out of the exposed public RPC schema and index FKs.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.fn_verified_reviews_is_support()
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

CREATE OR REPLACE FUNCTION private.fn_verified_reviews_validate()
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
  is_support := private.fn_verified_reviews_is_support();

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

GRANT EXECUTE ON FUNCTION private.fn_verified_reviews_is_support() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.fn_verified_reviews_validate() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_verified_reviews_validate ON public.verified_reviews;
CREATE TRIGGER trigger_verified_reviews_validate
  BEFORE INSERT OR UPDATE ON public.verified_reviews
  FOR EACH ROW EXECUTE FUNCTION private.fn_verified_reviews_validate();

DROP POLICY IF EXISTS "verified_reviews_public_read_approved" ON public.verified_reviews;
DROP POLICY IF EXISTS "verified_reviews_support_select_all" ON public.verified_reviews;
CREATE POLICY "verified_reviews_anon_read_approved"
  ON public.verified_reviews FOR SELECT
  TO anon
  USING (moderation_status = 'approved' AND is_public = true);
CREATE POLICY "verified_reviews_authenticated_read"
  ON public.verified_reviews FOR SELECT
  TO authenticated
  USING (
    (moderation_status = 'approved' AND is_public = true)
    OR private.fn_verified_reviews_is_support()
  );

DROP POLICY IF EXISTS "verified_reviews_author_response_pending" ON public.verified_reviews;
DROP POLICY IF EXISTS "verified_reviews_support_update_all" ON public.verified_reviews;
CREATE POLICY "verified_reviews_authenticated_update"
  ON public.verified_reviews FOR UPDATE
  TO authenticated
  USING (
    private.fn_verified_reviews_is_support()
    OR (
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
  )
  WITH CHECK (
    private.fn_verified_reviews_is_support()
    OR (
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
    )
  );

CREATE INDEX IF NOT EXISTS idx_verified_reviews_quotation_id
  ON public.verified_reviews (quotation_id)
  WHERE quotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verified_reviews_studio_job_id
  ON public.verified_reviews (studio_job_id)
  WHERE studio_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verified_reviews_studio_membership_id
  ON public.verified_reviews (studio_membership_id)
  WHERE studio_membership_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_verified_reviews_spot_application_id
  ON public.verified_reviews (studio_spot_application_id)
  WHERE studio_spot_application_id IS NOT NULL;

REVOKE ALL ON FUNCTION public.fn_verified_reviews_is_support() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_verified_reviews_validate() FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.fn_verified_reviews_validate();
DROP FUNCTION IF EXISTS public.fn_verified_reviews_is_support();

NOTIFY pgrst, 'reload schema';

COMMIT;
