-- Artist registration can contribute an unclaimed studio name to the catalog.
-- It must never assign ownership to a different account or self-verify a studio.
BEGIN;
DROP POLICY IF EXISTS studios_authenticated_catalog_insert ON public.studios;
CREATE POLICY studios_authenticated_catalog_insert ON public.studios FOR INSERT TO authenticated
WITH CHECK (user_id IS NULL AND email IS NULL AND is_verified = false AND profile_complete = false);
NOTIFY pgrst, 'reload schema';
COMMIT;
