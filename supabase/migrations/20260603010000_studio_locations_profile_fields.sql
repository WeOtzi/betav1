-- studio_locations: per-sede profile fields, mirroring the studios-level ones
-- added in 20260603000000. Each sede (branch) can now carry its own photos and
-- recruiting state.
--
-- New columns:
--   photo_feed_items    — gallery of this sede's photos (JSONB array of {url,...})
--   workstation_photos  — gallery of this sede's work stations (same shape)
--   google_maps_url     — shareable Google Maps link for this sede
--   is_seeking_artists  — per-sede recruiting flag ("Buscando artistas")
--
-- Derived (no columns):
--   "Artistas en la sede" -> studio_artist_memberships.location_id
--   "Spots disponibles"   -> studio_spots WHERE location_id = sede AND status='open'
--
-- Additive + idempotent.

BEGIN;

ALTER TABLE public.studio_locations
  ADD COLUMN IF NOT EXISTS photo_feed_items   JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS workstation_photos JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS google_maps_url    TEXT,
  ADD COLUMN IF NOT EXISTS is_seeking_artists BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_studio_locations_seeking
  ON public.studio_locations (is_seeking_artists)
  WHERE is_seeking_artists = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
