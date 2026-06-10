-- studios: extra public-profile fields surfaced in the backoffice studio admin.
--
-- Adds three NEW columns:
--   workstation_photos  — gallery of the studio's work stations (chairs/booths),
--                         a JSONB array of {url, kind, category, sort} items, same
--                         shape as photo_feed_items.
--   google_maps_url     — a shareable Google Maps link to the studio.
--   is_seeking_artists  — recruiting flag ("Buscando artistas").
--
-- The other requested fields are NOT new columns — they already exist:
--   "Fotos del estudio"    -> reuses studios.photo_feed_items (existing gallery).
--   "Artistas en la sede"  -> derived from studio_artist_memberships.location_id.
--   "Spots disponibles"    -> derived from studio_spots WHERE status = 'open'.
--
-- All additive and idempotent so it is safe to re-run.

BEGIN;

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS workstation_photos JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS google_maps_url    TEXT,
  ADD COLUMN IF NOT EXISTS is_seeking_artists BOOLEAN NOT NULL DEFAULT false;

-- Lets the directory quickly list studios that are actively recruiting.
CREATE INDEX IF NOT EXISTS idx_studios_seeking_artists
  ON public.studios (is_seeking_artists)
  WHERE is_seeking_artists = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
