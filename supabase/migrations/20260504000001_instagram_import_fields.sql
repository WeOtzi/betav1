-- Schema additions for the "Import from Instagram" feature.
--
-- 1) Documents two NEW optional fields inside the existing JSONB arrays
--    (artists_db.gallery_feed_items, studios.photo_feed_items):
--      - caption  : original IG caption text
--      - permalink: source IG permalink, used to dedup re-imports
--    These are additive — items written before this migration are still
--    valid; readers must treat caption/permalink as optional.
--
-- 2) Creates instagram_imports as an audit/metrics table. One row per
--    successful commit. Used for:
--      - Legal trail (who imported what, when)
--      - Dashboard UI ("Last sync: X days ago") without scanning JSONB
--      - Cost tracking (estimate per import in USD)

COMMENT ON COLUMN public.artists_db.gallery_feed_items IS
    'Array of {url, category, kind, created_at, caption?, permalink?}. caption: original IG caption (optional). permalink: source IG permalink for dedup on re-import (optional).';

COMMENT ON COLUMN public.studios.photo_feed_items IS
    'Array of {url, category, kind, created_at, caption?, permalink?}. caption: original IG caption (optional). permalink: source IG permalink for dedup on re-import (optional).';

CREATE TABLE IF NOT EXISTS public.instagram_imports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target            TEXT NOT NULL CHECK (target IN ('artist','studio')),
    ig_handle         TEXT NOT NULL,
    imported_fields   JSONB NOT NULL,
    apify_run_id      TEXT,
    cost_estimate_usd NUMERIC(10,4),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.instagram_imports IS
    'Audit log of Instagram profile imports. One row per commit (preview calls do not write here). imported_fields shape: {bio:bool, bio_link:bool, location:bool, photos:int, reels:int}.';

CREATE INDEX IF NOT EXISTS idx_instagram_imports_user
    ON public.instagram_imports (user_id, created_at DESC);

ALTER TABLE public.instagram_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own imports" ON public.instagram_imports;
CREATE POLICY "users read own imports"
    ON public.instagram_imports
    FOR SELECT
    USING (auth.uid() = user_id);
