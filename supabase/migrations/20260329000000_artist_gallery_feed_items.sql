-- Artist gallery feed categories for public profile tabs.
-- Keeps the legacy gallery_images column as the compatibility mirror used by
-- the existing frontend, while gallery_feed_items becomes the normalized source
-- of truth for feed-aware clients.

BEGIN;

-- ================================================================
-- STEP 1: Helpers for feed normalization and validation
-- ================================================================
CREATE OR REPLACE FUNCTION public.artist_gallery_url_kind(url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN url ~* '\.(mp4|mov|m4v|webm)(\?.*)?$' THEN 'video'
    ELSE 'image'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.artist_gallery_feed_items_are_valid(items jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  item jsonb;
  item_url text;
  item_category text;
  item_kind text;
  item_created_at text;
BEGIN
  IF items IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(items) <> 'array' THEN
    RETURN false;
  END IF;

  FOR item IN SELECT elem FROM jsonb_array_elements(items) AS elem LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RETURN false;
    END IF;

    item_url := btrim(COALESCE(item->>'url', ''));
    item_category := btrim(COALESCE(item->>'category', ''));
    item_kind := btrim(COALESCE(item->>'kind', ''));
    item_created_at := btrim(COALESCE(item->>'created_at', ''));

    IF item_url = '' THEN
      RETURN false;
    END IF;

    IF item_category NOT IN ('realizados', 'flash', 'proyectos') THEN
      RETURN false;
    END IF;

    IF item_kind NOT IN ('image', 'video') THEN
      RETURN false;
    END IF;

    IF item_created_at = '' THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.artist_gallery_feed_items_from_legacy_images(legacy_images jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  item jsonb;
  item_url text;
  normalized jsonb := '[]'::jsonb;
BEGIN
  IF legacy_images IS NULL OR jsonb_typeof(legacy_images) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR item IN SELECT elem FROM jsonb_array_elements(legacy_images) AS elem LOOP
    item_url := CASE jsonb_typeof(item)
      WHEN 'object' THEN btrim(COALESCE(item->>'url', ''))
      WHEN 'string' THEN btrim(trim(both '"' from item::text))
      ELSE ''
    END;

    IF item_url = '' THEN
      CONTINUE;
    END IF;

    normalized := normalized || jsonb_build_array(
      jsonb_build_object(
        'url', item_url,
        'category', 'realizados',
        'kind', public.artist_gallery_url_kind(item_url),
        'created_at', timezone('utc', now())::text
      )
    );
  END LOOP;

  RETURN normalized;
END;
$function$;

CREATE OR REPLACE FUNCTION public.artist_gallery_feed_items_to_legacy_images(feed_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  item jsonb;
  item_url text;
  legacy jsonb := '[]'::jsonb;
BEGIN
  IF feed_items IS NULL OR jsonb_typeof(feed_items) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR item IN SELECT elem FROM jsonb_array_elements(feed_items) AS elem LOOP
    item_url := CASE jsonb_typeof(item)
      WHEN 'object' THEN btrim(COALESCE(item->>'url', ''))
      WHEN 'string' THEN btrim(trim(both '"' from item::text))
      ELSE ''
    END;

    IF item_url = '' THEN
      CONTINUE;
    END IF;

    legacy := legacy || jsonb_build_array(item_url);
  END LOOP;

  RETURN legacy;
END;
$function$;

-- ================================================================
-- STEP 2: Add normalized feed column
-- ================================================================
ALTER TABLE public.artists_db
  ADD COLUMN IF NOT EXISTS gallery_feed_items JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.artists_db
  ALTER COLUMN gallery_feed_items SET DEFAULT '[]'::jsonb;

UPDATE public.artists_db
SET gallery_feed_items = '[]'::jsonb
WHERE gallery_feed_items IS NULL;

ALTER TABLE public.artists_db
  ALTER COLUMN gallery_feed_items SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artists_db_gallery_feed_items_shape_check'
      AND conrelid = 'public.artists_db'::regclass
  ) THEN
    ALTER TABLE public.artists_db
      ADD CONSTRAINT artists_db_gallery_feed_items_shape_check
      CHECK (public.artist_gallery_feed_items_are_valid(gallery_feed_items));
  END IF;
END;
$$;

-- ================================================================
-- STEP 3: Keep legacy gallery_images in sync with the new feed
-- ================================================================
CREATE OR REPLACE FUNCTION public.sync_artist_gallery_feed_items()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.gallery_images IS NULL OR jsonb_typeof(NEW.gallery_images) <> 'array' THEN
    NEW.gallery_images := '[]'::jsonb;
  END IF;

  IF NEW.gallery_feed_items IS NULL THEN
    NEW.gallery_feed_items := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(NEW.gallery_feed_items) = 'array' AND jsonb_array_length(NEW.gallery_feed_items) > 0 THEN
    NEW.gallery_images := public.artist_gallery_feed_items_to_legacy_images(NEW.gallery_feed_items);
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.gallery_images) = 'array' AND jsonb_array_length(NEW.gallery_images) > 0 THEN
    NEW.gallery_feed_items := public.artist_gallery_feed_items_from_legacy_images(NEW.gallery_images);
    NEW.gallery_images := public.artist_gallery_feed_items_to_legacy_images(NEW.gallery_feed_items);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_artist_gallery_feed_items ON public.artists_db;
CREATE TRIGGER trigger_sync_artist_gallery_feed_items
  BEFORE INSERT OR UPDATE OF gallery_images, gallery_feed_items
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artist_gallery_feed_items();

-- ================================================================
-- STEP 4: Backfill existing legacy gallery images into the feed column
-- ================================================================
UPDATE public.artists_db
SET gallery_feed_items = public.artist_gallery_feed_items_from_legacy_images(gallery_images),
    gallery_images = public.artist_gallery_feed_items_to_legacy_images(
      public.artist_gallery_feed_items_from_legacy_images(gallery_images)
    )
WHERE gallery_feed_items = '[]'::jsonb
  AND gallery_images IS NOT NULL
  AND jsonb_typeof(gallery_images) = 'array'
  AND jsonb_array_length(gallery_images) > 0;

NOTIFY pgrst, 'reload schema';

COMMIT;
