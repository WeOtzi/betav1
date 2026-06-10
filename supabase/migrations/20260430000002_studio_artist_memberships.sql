-- studio_artist_memberships: the canonical artist↔studio relationship.
--
-- Today we have two parallel signals:
--   - artists_db.studio_id (single FK; the artist's "primary" studio)
--   - artist_tattoo_locations (junction with current/upcoming periods)
--
-- Neither captures *role* (resident vs itinerant vs guest vs manager) or
-- *split* (revenue percentage). Memberships add both, and become the
-- source of truth that the studio dashboard reads from.
--
-- artists_db.studio_id is kept as a denormalized "primary studio" pointer
-- via a trigger that picks the most recent active resident membership.

BEGIN;

-- ============================================================
-- Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.studio_artist_memberships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id           UUID NOT NULL REFERENCES public.studios(id)        ON DELETE CASCADE,
  artist_user_id      UUID NOT NULL REFERENCES public.artists_db(user_id) ON DELETE CASCADE,
  location_id         UUID          REFERENCES public.studio_locations(id) ON DELETE SET NULL,

  role                TEXT NOT NULL DEFAULT 'resident'
    CHECK (role IN ('resident', 'itinerant', 'guest', 'manager')),

  -- Revenue split (optional; null means "not configured yet")
  revenue_split_pct   NUMERIC(5,2)
    CHECK (revenue_split_pct IS NULL
        OR (revenue_split_pct >= 0 AND revenue_split_pct <= 100)),

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending_invite', 'pending_acceptance', 'active', 'paused', 'ended', 'rejected')),
  is_active           BOOLEAN GENERATED ALWAYS AS (status = 'active') STORED,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  invited_at          TIMESTAMPTZ,
  invited_by_user_id  UUID,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

  -- An artist can have at most ONE active row per (studio, role) pair.
  -- (e.g. one "resident" at studio X plus one "guest" stint at the same X = OK)
  CONSTRAINT studio_artist_memberships_no_double_active
    UNIQUE NULLS NOT DISTINCT (studio_id, artist_user_id, role, status)
);

CREATE INDEX IF NOT EXISTS idx_sam_studio    ON public.studio_artist_memberships (studio_id);
CREATE INDEX IF NOT EXISTS idx_sam_artist    ON public.studio_artist_memberships (artist_user_id);
CREATE INDEX IF NOT EXISTS idx_sam_location  ON public.studio_artist_memberships (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sam_active    ON public.studio_artist_memberships (studio_id, artist_user_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.set_sam_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at := timezone('utc', now()); RETURN NEW; END;
$function$;

DROP TRIGGER IF EXISTS trigger_sam_updated_at ON public.studio_artist_memberships;
CREATE TRIGGER trigger_sam_updated_at
  BEFORE UPDATE ON public.studio_artist_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_sam_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.studio_artist_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sam_public_select_active"   ON public.studio_artist_memberships;
DROP POLICY IF EXISTS "sam_studio_or_artist_write" ON public.studio_artist_memberships;
DROP POLICY IF EXISTS "sam_studio_or_artist_read"  ON public.studio_artist_memberships;

-- Public can SELECT active memberships only (so studio profiles can list
-- their roster). Pending/ended rows are hidden from the public.
CREATE POLICY "sam_public_select_active"
  ON public.studio_artist_memberships FOR SELECT
  USING (status = 'active');

-- Studio owners and the artist themselves can read all rows that involve
-- them (including pending invites). Support too.
CREATE POLICY "sam_studio_or_artist_read"
  ON public.studio_artist_memberships FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      auth.uid() = artist_user_id
      OR EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
    )
  );

-- Writes: studio owner can do everything; the artist can update status of
-- their own row (e.g. accept/reject an invite); support always.
CREATE POLICY "sam_studio_or_artist_write"
  ON public.studio_artist_memberships FOR ALL
  USING (
    auth.uid() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
      OR auth.uid() = artist_user_id
      OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.studios s WHERE s.id = studio_id AND s.user_id = auth.uid())
      OR auth.uid() = artist_user_id
      OR EXISTS (SELECT 1 FROM public.support_users_db su WHERE su.user_id = auth.uid() AND su.is_active = true)
    )
  );

-- ============================================================
-- Backfill from existing signals
-- ============================================================
-- Strategy: for every artists_db row with a studio_id, create a single
-- 'active' resident membership pointing to that studio's primary location.
-- Then for every artist_tattoo_locations row whose studio_id is set,
-- create matching guest/resident memberships if not already present.

INSERT INTO public.studio_artist_memberships (
  studio_id, artist_user_id, location_id, role, status, started_at
)
SELECT
  a.studio_id,
  a.user_id,
  s.primary_location_id,
  'resident',
  'active',
  COALESCE(a.index_updated_at, timezone('utc', now()))
FROM public.artists_db a
JOIN public.studios s ON s.id = a.studio_id
WHERE a.studio_id IS NOT NULL
  AND a.work_type IN ('studio', 'both')
  AND NOT EXISTS (
    SELECT 1 FROM public.studio_artist_memberships m
    WHERE m.studio_id = a.studio_id
      AND m.artist_user_id = a.user_id
      AND m.role = 'resident'
      AND m.status = 'active'
  );

-- Junction table backfill (current = resident, upcoming = guest).
INSERT INTO public.studio_artist_memberships (
  studio_id, artist_user_id, location_id, role, status, started_at, ended_at
)
SELECT
  atl.studio_id,
  atl.artist_user_id,
  s.primary_location_id,
  CASE WHEN atl.period_type = 'upcoming' THEN 'guest' ELSE 'resident' END,
  'active',
  COALESCE(atl.start_date::timestamptz, atl.created_at, timezone('utc', now())),
  CASE WHEN atl.period_type = 'upcoming' THEN atl.end_date::timestamptz ELSE NULL END
FROM public.artist_tattoo_locations atl
JOIN public.studios s ON s.id = atl.studio_id
WHERE atl.studio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.studio_artist_memberships m
    WHERE m.studio_id = atl.studio_id
      AND m.artist_user_id = atl.artist_user_id
      AND m.role = (CASE WHEN atl.period_type = 'upcoming' THEN 'guest' ELSE 'resident' END)
      AND m.status = 'active'
  );

-- ============================================================
-- Trigger: keep artists_db.studio_id in sync with the most recent active
-- resident membership (denormalized convenience).
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_artists_db_studio_id_from_membership()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  affected_artist UUID;
BEGIN
  affected_artist := COALESCE(NEW.artist_user_id, OLD.artist_user_id);
  IF affected_artist IS NULL THEN RETURN NULL; END IF;

  UPDATE public.artists_db a
  SET studio_id = (
    SELECT m.studio_id
    FROM public.studio_artist_memberships m
    WHERE m.artist_user_id = affected_artist
      AND m.status = 'active'
      AND m.role = 'resident'
    ORDER BY m.started_at DESC NULLS LAST, m.created_at DESC
    LIMIT 1
  )
  WHERE a.user_id = affected_artist;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_artists_studio_id ON public.studio_artist_memberships;
CREATE TRIGGER trigger_sync_artists_studio_id
  AFTER INSERT OR UPDATE OR DELETE ON public.studio_artist_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artists_db_studio_id_from_membership();

NOTIFY pgrst, 'reload schema';

COMMIT;
