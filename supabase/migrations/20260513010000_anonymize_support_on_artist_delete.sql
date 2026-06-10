-- Fix: backoffice artist deletion failed for artists with logged-in-only
-- support_conversations (anonymous_id IS NULL).
--
-- Chain that broke:
--   1. DELETE FROM artists_db WHERE user_id = X
--   2. AFTER DELETE trigger calls DELETE FROM auth.users WHERE id = X
--   3. FK support_conversations.user_id -> auth.users with ON DELETE SET NULL
--      nulls user_id on those rows
--   4. CHECK support_conv_identity_chk requires anonymous_id OR user_id to
--      be non-null. For rows that never had an anonymous_id, this fails.
--   5. The whole transaction aborts and the artist stays in the DB.
--
-- The fix: in the artist-delete trigger, anonymize affected conversations
-- (set anonymous_id = OLD.user_id as a tombstone) before deleting
-- auth.users. The FK cascade then sets user_id = NULL, but the CHECK
-- still holds because anonymous_id is now non-null. Using OLD.user_id as
-- the tombstone preserves traceability ("which deleted user did this
-- conversation belong to?").

CREATE OR REPLACE FUNCTION public.delete_auth_on_artist_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.user_id IS NULL THEN
    RETURN OLD;
  END IF;

  IF lower(coalesce(OLD.email, '')) = 'isai@weotzi.com'
     OR EXISTS (
       SELECT 1
       FROM auth.users u
       WHERE u.id = OLD.user_id
         AND lower(coalesce(u.email, '')) = 'isai@weotzi.com'
     ) THEN
    RETURN OLD;
  END IF;

  UPDATE public.support_conversations
  SET anonymous_id = OLD.user_id
  WHERE user_id = OLD.user_id
    AND anonymous_id IS NULL;

  DELETE FROM auth.users WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;
