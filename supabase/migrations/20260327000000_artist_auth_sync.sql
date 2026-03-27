-- Migration: artist_auth_sync
-- Syncs name → display_name and whatsapp_number → phone between artists_db and auth.users
-- Also cascades deletes in both directions

-- ============================================================
-- FUNCTION 1: Sync name + whatsapp_number → auth.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_artist_to_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE auth.users
    SET
      raw_user_meta_data = raw_user_meta_data || jsonb_build_object('display_name', NEW.name),
      phone = NEW.whatsapp_number
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger 1: fires after INSERT or UPDATE of name or whatsapp_number
DROP TRIGGER IF EXISTS trigger_sync_artist_to_auth ON public.artists_db;
CREATE TRIGGER trigger_sync_artist_to_auth
  AFTER INSERT OR UPDATE OF name, whatsapp_number
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artist_to_auth();

-- ============================================================
-- FUNCTION 2: Delete auth.users when artist is deleted
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_auth_on_artist_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;

-- Trigger 2: fires after DELETE on artists_db
DROP TRIGGER IF EXISTS trigger_delete_auth_on_artist_delete ON public.artists_db;
CREATE TRIGGER trigger_delete_auth_on_artist_delete
  AFTER DELETE
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_auth_on_artist_delete();

-- ============================================================
-- FUNCTION 3: Delete artists_db when auth user is deleted
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_artist_on_auth_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  DELETE FROM public.artists_db WHERE user_id = OLD.id;
  RETURN OLD;
END;
$$;

-- Trigger 3: fires after DELETE on auth.users
DROP TRIGGER IF EXISTS trigger_delete_artist_on_auth_delete ON auth.users;
CREATE TRIGGER trigger_delete_artist_on_auth_delete
  AFTER DELETE
  ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_artist_on_auth_delete();
