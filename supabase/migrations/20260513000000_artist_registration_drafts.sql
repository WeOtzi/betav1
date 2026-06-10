-- Artist registration drafts: keep artists_db as the draft source of truth
-- without creating auth.users until the final confirmation step.

ALTER TABLE public.artists_db
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN user_id DROP DEFAULT;

ALTER TABLE public.artists_db
  ADD COLUMN IF NOT EXISTS registration_draft_id UUID,
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'pendiente de validacion',
  ADD COLUMN IF NOT EXISTS registration_source TEXT,
  ADD COLUMN IF NOT EXISTS registration_step INTEGER,
  ADD COLUMN IF NOT EXISTS registration_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_last_saved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_submitted_at TIMESTAMPTZ;

UPDATE public.artists_db
SET registration_status = 'pendiente de validacion'
WHERE registration_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artists_db_registration_status_check'
      AND conrelid = 'public.artists_db'::regclass
  ) THEN
    ALTER TABLE public.artists_db
      ADD CONSTRAINT artists_db_registration_status_check
      CHECK (registration_status IN ('incompleto', 'pendiente de validacion'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'artists_db_registration_step_check'
      AND conrelid = 'public.artists_db'::regclass
  ) THEN
    ALTER TABLE public.artists_db
      ADD CONSTRAINT artists_db_registration_step_check
      CHECK (registration_step IS NULL OR registration_step BETWEEN 0 AND 12);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_db_registration_draft_id
  ON public.artists_db (registration_draft_id)
  WHERE registration_draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artists_db_registration_status
  ON public.artists_db (registration_status, registration_last_saved_at DESC);

DROP POLICY IF EXISTS "Authenticated can view all artists for marketplace" ON public.artists_db;
CREATE POLICY "Authenticated can view all artists for marketplace"
  ON public.artists_db FOR SELECT
  USING (registration_status IS DISTINCT FROM 'incompleto');

DROP POLICY IF EXISTS "Public can view artists for marketplace" ON public.artists_db;
CREATE POLICY "Public can view artists for marketplace"
  ON public.artists_db FOR SELECT
  USING (registration_status IS DISTINCT FROM 'incompleto');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  extracted_name text;
  extracted_username text;
  linked_artist_id uuid;
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

  UPDATE public.artists_db
  SET
    user_id = new.id,
    email = lower(new.email),
    name = COALESCE(NULLIF(public.artists_db.name, ''), extracted_name),
    username = COALESCE(NULLIF(public.artists_db.username, ''), extracted_username),
    registration_status = 'pendiente de validacion',
    registration_submitted_at = COALESCE(public.artists_db.registration_submitted_at, now()),
    registration_last_saved_at = now()
  WHERE lower(coalesce(public.artists_db.email, '')) = lower(coalesce(new.email, ''))
    AND public.artists_db.user_id IS NULL
    AND public.artists_db.registration_status = 'incompleto'
  RETURNING id INTO linked_artist_id;

  IF linked_artist_id IS NOT NULL THEN
    RETURN new;
  END IF;

  INSERT INTO public.artists_db (
    user_id,
    email,
    name,
    username,
    registration_status,
    registration_source,
    registration_started_at,
    registration_last_saved_at,
    registration_submitted_at
  )
  VALUES (
    new.id,
    lower(new.email),
    extracted_name,
    extracted_username,
    'pendiente de validacion',
    COALESCE(new.raw_user_meta_data->>'registration_source', 'manual'),
    now(),
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(NULLIF(artists_db.name, ''), EXCLUDED.name),
    username = COALESCE(NULLIF(artists_db.username, ''), EXCLUDED.username),
    registration_status = 'pendiente de validacion',
    registration_last_saved_at = now(),
    registration_submitted_at = COALESCE(artists_db.registration_submitted_at, now());

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

  DELETE FROM auth.users WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;
