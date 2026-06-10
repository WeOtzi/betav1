-- Tighten private helper function execute privileges for verified reviews.

BEGIN;

REVOKE ALL ON FUNCTION private.fn_verified_reviews_validate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_verified_reviews_is_support() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_verified_reviews_is_support() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.fn_verified_reviews_validate() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
