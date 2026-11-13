-- Reversa de 20261112120000_studio_claim_links.sql.
-- Restaura public.complete_studio_registration a su forma previa (wrapper SQL
-- que delega en private.complete_studio_registration) y quita link de alta,
-- guard y columnas nuevas de studios.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_studio_registration(p_profile jsonb, p_locations jsonb)
RETURNS public.studios LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT private.complete_studio_registration(p_profile, p_locations);
$$;
REVOKE ALL ON FUNCTION public.complete_studio_registration(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_studio_registration(jsonb, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS private.claim_studio_with_link(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.issue_studio_claim_link(uuid, text, uuid, integer);

DROP TRIGGER IF EXISTS trg_guard_studio_location_verified ON public.studios;
DROP FUNCTION IF EXISTS private.guard_studio_location_verified();

DROP TABLE IF EXISTS public.studio_claim_links;

DROP INDEX IF EXISTS public.idx_studios_created_by_artist;
ALTER TABLE public.studios
  DROP COLUMN IF EXISTS created_by_artist_user_id,
  DROP COLUMN IF EXISTS location_verified;

NOTIFY pgrst, 'reload schema';
COMMIT;
