-- Extend artist_gallery_feed_items_are_valid() to accept the new
-- 'instagram' and 'instagram-reel' categories used by the IG import feature.
-- Existing categories ('realizados', 'flash', 'proyectos') stay valid.

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

    IF item_category NOT IN ('realizados', 'flash', 'proyectos', 'instagram', 'instagram-reel') THEN
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
