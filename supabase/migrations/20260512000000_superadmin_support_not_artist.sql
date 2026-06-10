-- Keep the fixed superadmin account as support/admin data, never as an artist.
-- The historical Auth <-> artists sync triggers are still valid for artist
-- accounts, but the owner account must be excluded from that coupling.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  extracted_name text;
  extracted_username text;
BEGIN
  IF lower(coalesce(new.email, '')) = 'isai@weotzi.com'
     OR lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'superadmin'
     OR lower(coalesce(new.raw_app_meta_data->>'role', '')) = 'superadmin' THEN
    RETURN new;
  END IF;

  extracted_name := COALESCE(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  extracted_username := COALESCE(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'preferred_username',
    split_part(new.email, '@', 1)
  );

  INSERT INTO public.artists_db (user_id, email, name, username)
  VALUES (
    new.id,
    new.email,
    extracted_name,
    extracted_username
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(artists_db.name, EXCLUDED.name),
    username = COALESCE(artists_db.username, EXCLUDED.username);

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_auth_on_artist_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF lower(coalesce(OLD.email, '')) = 'isai@weotzi.com'
     OR EXISTS (
       SELECT 1
       FROM auth.users u
       WHERE u.id = OLD.user_id
         AND lower(coalesce(u.email, '')) = 'isai@weotzi.com'
     ) THEN
    RETURN OLD;
  END IF;

  DELETE FROM auth.users WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;

INSERT INTO public.support_users_db (
  user_id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  updated_at
)
SELECT
  u.id,
  lower(u.email),
  'Soporte Superadmin',
  'admin',
  true,
  now(),
  now()
FROM auth.users u
WHERE lower(coalesce(u.email, '')) = 'isai@weotzi.com'
ON CONFLICT (user_id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  is_active = true,
  updated_at = now();

DELETE FROM public.artists_db
WHERE lower(coalesce(email, '')) = 'isai@weotzi.com';
