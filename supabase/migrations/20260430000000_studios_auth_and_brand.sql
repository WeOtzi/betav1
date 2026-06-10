-- Studios as a first-class user type: add identity, brand, and contact columns.
--
-- Until now `studios` was a catalog (just `name` + `normalized_name` + a
-- single address). Promoting studios to a user type means each studio row is
-- now owned by a Supabase Auth user via `studios.user_id`. This migration
-- adds the auth FK, the public brand columns, and the contact channels.
-- A separate migration moves the address columns out into studio_locations.

BEGIN;

-- ============================================================
-- Columns
-- ============================================================
ALTER TABLE public.studios
  -- Auth ownership (nullable to allow legacy studios without an owner).
  ADD COLUMN IF NOT EXISTS user_id          UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email            TEXT UNIQUE,

  -- Public brand
  ADD COLUMN IF NOT EXISTS slug             TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS tagline          TEXT,
  ADD COLUMN IF NOT EXISTS bio              TEXT,
  ADD COLUMN IF NOT EXISTS cover_image      TEXT,
  ADD COLUMN IF NOT EXISTS logo_image       TEXT,
  ADD COLUMN IF NOT EXISTS photo_feed_items JSONB        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS founded_year     INTEGER,
  ADD COLUMN IF NOT EXISTS languages        TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Public socials / contact
  ADD COLUMN IF NOT EXISTS instagram        TEXT,
  ADD COLUMN IF NOT EXISTS tiktok           TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp         TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone    TEXT,

  -- Operational state
  ADD COLUMN IF NOT EXISTS is_verified      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN      NOT NULL DEFAULT false;

-- Indexes for the new lookups.
CREATE INDEX IF NOT EXISTS idx_studios_user_id ON public.studios (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_studios_slug    ON public.studios (slug)    WHERE slug    IS NOT NULL;

-- Backfill `slug` from normalized_name for existing rows. Slug is more
-- URL-friendly: lowercase, ascii-ish, hyphenated.
UPDATE public.studios
SET slug = regexp_replace(
  regexp_replace(lower(normalized_name), '[^a-z0-9]+', '-', 'g'),
  '(^-|-$)', '', 'g'
)
WHERE slug IS NULL AND normalized_name IS NOT NULL;

-- ============================================================
-- RLS
-- ============================================================
-- The catalog already had RLS enabled (rls_enabled=true). Refresh policies
-- so studios can read+update their own row, anonymous users can SELECT the
-- public columns, and support staff can do everything via is_support_user().

-- Drop any prior policies we're about to replace (idempotent).
DROP POLICY IF EXISTS "studios_public_select"       ON public.studios;
DROP POLICY IF EXISTS "studios_owner_update"        ON public.studios;
DROP POLICY IF EXISTS "studios_anyone_create_via_app" ON public.studios;

-- Public: anyone can read studios (public directory).
CREATE POLICY "studios_public_select"
  ON public.studios FOR SELECT
  USING (true);

-- Owner: the studio's auth user can update its own row. Support too.
CREATE POLICY "studios_owner_update"
  ON public.studios FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM public.support_users_db s
        WHERE s.user_id = auth.uid() AND s.is_active = true
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      auth.uid() = user_id
      OR EXISTS (
        SELECT 1 FROM public.support_users_db s
        WHERE s.user_id = auth.uid() AND s.is_active = true
      )
    )
  );

-- Insert: any authenticated user can create a studios row, BUT they may
-- only set their own auth.uid() as the owner. This is what the registration
-- wizard does. Support can also insert on anyone's behalf.
CREATE POLICY "studios_anyone_create_via_app"
  ON public.studios FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.support_users_db s
        WHERE s.user_id = auth.uid() AND s.is_active = true
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
