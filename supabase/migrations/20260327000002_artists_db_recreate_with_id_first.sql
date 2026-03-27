-- Recreate artists_db with id as FIRST column to fix Supabase Table Editor
-- row selection bug (WHERE id IN () empty list).
--
-- Root cause: Supabase Table Editor fails to identify rows when the PK column
-- is not in the first ordinal position. The id column was previously at
-- position 49 (added via ALTER TABLE ADD COLUMN). This migration recreates
-- the table with id in position 1.
--
-- What is preserved: all 61 rows, all 11 custom indexes, all 3 FKs (incoming
-- and outgoing), all 8 RLS policies, all 3 triggers, and the two row-type
-- functions (calculate_artist_index, calculate_profile_completeness).

BEGIN;

-- ================================================================
-- STEP 1: Create artists_db_new with id as FIRST column
-- ================================================================
CREATE TABLE public.artists_db_new (
  id                       UUID        NOT NULL DEFAULT gen_random_uuid(),
  name                     TEXT,
  estilo                   TEXT,
  ubicacion                TEXT,
  instagram                TEXT,
  email                    TEXT,
  whatsapp_number          TEXT,
  portafolio               TEXT,
  estudios                 TEXT,
  embajador                TEXT,
  session_price            TEXT,
  whatsapp_url             TEXT,
  username                 TEXT,
  user_id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  city                     TEXT,
  styles_array             TEXT[],
  vacation_start           DATE,
  vacation_end             DATE,
  bio_description          TEXT,
  birth_date               DATE,
  idx                      INTEGER,
  subscribed_newsletter    BOOLEAN     DEFAULT false,
  years_experience         TEXT,
  password                 TEXT,
  profile_picture          TEXT,
  email_confirmed          BOOLEAN     DEFAULT false,
  is_recommended           BOOLEAN     DEFAULT false,
  languages                TEXT[]      DEFAULT ARRAY['Español'::text],
  country                  TEXT,
  custom_canvas_labels     TEXT[]      DEFAULT '{}'::text[],
  nivel                    TEXT        DEFAULT 'Nuevo'::text,
  ms_profile_complete      BOOLEAN     DEFAULT false,
  ms_first_quote_received  BOOLEAN     DEFAULT false,
  ms_whatsapp_shared       BOOLEAN     DEFAULT false,
  ms_profile_shared        BOOLEAN     DEFAULT false,
  ms_first_quote_completed BOOLEAN     DEFAULT false,
  artist_index             INTEGER     DEFAULT 0,
  index_updated_at         TIMESTAMPTZ,
  profile_completeness     INTEGER     DEFAULT 0,
  verification_state       TEXT        DEFAULT 'No'::text,
  gallery_images           JSONB       DEFAULT '[]'::jsonb,
  dashboard_config         JSONB,
  studio_id                UUID,
  work_type                TEXT,

  CONSTRAINT artists_db_new_pkey            PRIMARY KEY (id),
  CONSTRAINT artists_db_new_user_id_unique  UNIQUE (user_id),
  CONSTRAINT artists_db_new_studio_id_fkey  FOREIGN KEY (studio_id) REFERENCES public.studios(id)
);

-- ================================================================
-- STEP 2: Copy ALL data from old table
-- ================================================================
INSERT INTO public.artists_db_new (
  id, name, estilo, ubicacion, instagram, email, whatsapp_number, portafolio,
  estudios, embajador, session_price, whatsapp_url, username, user_id, city,
  styles_array, vacation_start, vacation_end, bio_description, birth_date, idx,
  subscribed_newsletter, years_experience, password, profile_picture, email_confirmed,
  is_recommended, languages, country, custom_canvas_labels, nivel,
  ms_profile_complete, ms_first_quote_received, ms_whatsapp_shared, ms_profile_shared,
  ms_first_quote_completed, artist_index, index_updated_at, profile_completeness,
  verification_state, gallery_images, dashboard_config, studio_id, work_type
)
SELECT
  id, name, estilo, ubicacion, instagram, email, whatsapp_number, portafolio,
  estudios, embajador, session_price, whatsapp_url, username, user_id, city,
  styles_array, vacation_start, vacation_end, bio_description, birth_date, idx,
  subscribed_newsletter, years_experience, password, profile_picture, email_confirmed,
  is_recommended, languages, country, custom_canvas_labels, nivel,
  ms_profile_complete, ms_first_quote_received, ms_whatsapp_shared, ms_profile_shared,
  ms_first_quote_completed, artist_index, index_updated_at, profile_completeness,
  verification_state, gallery_images, dashboard_config, studio_id, work_type
FROM public.artists_db;

-- ================================================================
-- STEP 3: Verify row count
-- ================================================================
DO $$
DECLARE
  old_count INTEGER;
  new_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO old_count FROM public.artists_db;
  SELECT COUNT(*) INTO new_count FROM public.artists_db_new;
  IF old_count != new_count THEN
    RAISE EXCEPTION 'ABORT: Row count mismatch — old=%, new=%', old_count, new_count;
  END IF;
  RAISE NOTICE 'OK: % rows copied successfully', new_count;
END;
$$;

-- ================================================================
-- STEP 4: Drop incoming FKs from other tables
-- ================================================================
ALTER TABLE public.quotations_db          DROP CONSTRAINT quotations_db_artist_id_fkey;
ALTER TABLE public.job_board_requests     DROP CONSTRAINT job_board_requests_accepted_artist_id_fkey;
ALTER TABLE public.job_board_applications DROP CONSTRAINT job_board_applications_artist_id_fkey;

-- ================================================================
-- STEP 5: Rename old constraints to free up their names
-- ================================================================
ALTER TABLE public.artists_db RENAME CONSTRAINT artists_db_pkey           TO artists_db_old_pkey;
ALTER TABLE public.artists_db RENAME CONSTRAINT artists_db_user_id_unique  TO artists_db_old_user_id_unique;
ALTER TABLE public.artists_db RENAME CONSTRAINT artists_db_studio_id_fkey  TO artists_db_old_studio_id_fkey;

-- ================================================================
-- STEP 6: Swap tables
-- ================================================================
ALTER TABLE public.artists_db     RENAME TO artists_db_backup;
ALTER TABLE public.artists_db_new RENAME TO artists_db;

-- ================================================================
-- STEP 7: Drop functions that depend on the old row type (artists_db_backup)
-- ================================================================
DROP FUNCTION public.calculate_artist_index(public.artists_db_backup);
DROP FUNCTION public.calculate_profile_completeness(public.artists_db_backup);

-- ================================================================
-- STEP 8: Drop backup table (no more dependencies blocking it)
-- ================================================================
DROP TABLE public.artists_db_backup;

-- ================================================================
-- STEP 9: Rename new constraints to final production names
-- ================================================================
ALTER TABLE public.artists_db RENAME CONSTRAINT artists_db_new_pkey           TO artists_db_pkey;
ALTER TABLE public.artists_db RENAME CONSTRAINT artists_db_new_user_id_unique  TO artists_db_user_id_unique;
ALTER TABLE public.artists_db RENAME CONSTRAINT artists_db_new_studio_id_fkey  TO artists_db_studio_id_fkey;

-- ================================================================
-- STEP 10: Recreate custom indexes
-- ================================================================
CREATE INDEX idx_artists_city           ON public.artists_db USING btree (city);
CREATE INDEX idx_artists_country        ON public.artists_db USING btree (country);
CREATE INDEX idx_artists_db_studio_id   ON public.artists_db USING btree (studio_id);
CREATE INDEX idx_artists_embajador      ON public.artists_db USING btree (embajador) WHERE embajador IS NOT NULL;
CREATE INDEX idx_artists_languages_gin  ON public.artists_db USING gin (languages);
CREATE INDEX idx_artists_marketplace    ON public.artists_db USING btree (country, city, is_recommended);
CREATE INDEX idx_artists_recommended    ON public.artists_db USING btree (is_recommended) WHERE is_recommended = true;
CREATE INDEX idx_artists_score          ON public.artists_db USING btree (artist_index DESC);
CREATE INDEX idx_artists_score_location ON public.artists_db USING btree (artist_index DESC, country, city);
CREATE INDEX idx_artists_styles_gin     ON public.artists_db USING gin (styles_array);
CREATE INDEX idx_artists_vacation       ON public.artists_db USING btree (vacation_start, vacation_end) WHERE vacation_start IS NOT NULL;

-- ================================================================
-- STEP 11: Re-add incoming FK constraints
-- ================================================================
ALTER TABLE public.quotations_db
  ADD CONSTRAINT quotations_db_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES public.artists_db(user_id) ON DELETE SET NULL;

ALTER TABLE public.job_board_requests
  ADD CONSTRAINT job_board_requests_accepted_artist_id_fkey
  FOREIGN KEY (accepted_artist_id) REFERENCES public.artists_db(user_id) ON DELETE NO ACTION;

ALTER TABLE public.job_board_applications
  ADD CONSTRAINT job_board_applications_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES public.artists_db(user_id) ON DELETE CASCADE;

-- ================================================================
-- STEP 12: Enable RLS
-- ================================================================
ALTER TABLE public.artists_db ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- STEP 13: Recreate all 8 RLS policies
-- ================================================================
CREATE POLICY "Allow insert for registration"
  ON public.artists_db FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Artists can update own record"
  ON public.artists_db FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Artists can view own record"
  ON public.artists_db FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated can view all artists for marketplace"
  ON public.artists_db FOR SELECT
  USING (true);

CREATE POLICY "Public can view artists for marketplace"
  ON public.artists_db FOR SELECT
  USING (true);

CREATE POLICY "Support admins can delete artists"
  ON public.artists_db FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM support_users_db
    WHERE support_users_db.user_id = auth.uid()
      AND support_users_db.role = 'admin'
      AND support_users_db.is_active = true
  ));

CREATE POLICY "Support can update all artists"
  ON public.artists_db FOR UPDATE
  USING (is_support_user());

CREATE POLICY "Support can view all artists"
  ON public.artists_db FOR SELECT
  USING (is_support_user());

-- ================================================================
-- STEP 14: Recreate functions with new artists_db row type
-- ================================================================
CREATE OR REPLACE FUNCTION public.calculate_artist_index(artist_row public.artists_db)
RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE
  score_perfil integer := 0; score_reputacion integer := 0;
  campos_llenos integer := 0; total_campos integer := 11;
  indice_final integer; exp_years integer := 0;
BEGIN
  IF artist_row.name IS NOT NULL AND artist_row.name != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.username IS NOT NULL AND artist_row.username != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.profile_picture IS NOT NULL AND artist_row.profile_picture != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.bio_description IS NOT NULL AND artist_row.bio_description != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.city IS NOT NULL AND artist_row.city != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.country IS NOT NULL AND artist_row.country != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.styles_array IS NOT NULL AND array_length(artist_row.styles_array, 1) > 0 THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.session_price IS NOT NULL AND artist_row.session_price != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.years_experience IS NOT NULL AND artist_row.years_experience != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.instagram IS NOT NULL AND artist_row.instagram != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.whatsapp_number IS NOT NULL AND artist_row.whatsapp_number != '' THEN campos_llenos := campos_llenos + 1; END IF;
  score_perfil := (campos_llenos * 100) / total_campos;
  score_reputacion := 30;
  IF artist_row.is_recommended = true THEN score_reputacion := score_reputacion + 35; END IF;
  IF LOWER(artist_row.embajador) IN ('si', 'sí', 'yes', 'true') THEN score_reputacion := score_reputacion + 25; END IF;
  IF artist_row.years_experience IS NOT NULL AND artist_row.years_experience ~ '[0-9]' THEN
    BEGIN
      exp_years := (regexp_replace(artist_row.years_experience, '[^0-9]', '', 'g'))::integer;
      IF exp_years >= 10 THEN score_reputacion := score_reputacion + 10;
      ELSIF exp_years >= 5 THEN score_reputacion := score_reputacion + 5;
      ELSIF exp_years >= 1 THEN score_reputacion := score_reputacion + 2;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  score_reputacion := LEAST(score_reputacion, 100);
  indice_final := (score_perfil * 40 + score_reputacion * 60) / 100;
  RETURN LEAST(indice_final, 100);
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_profile_completeness(artist_row public.artists_db)
RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE campos_llenos integer := 0; total_campos integer := 11;
BEGIN
  IF artist_row.name IS NOT NULL AND artist_row.name != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.username IS NOT NULL AND artist_row.username != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.profile_picture IS NOT NULL AND artist_row.profile_picture != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.bio_description IS NOT NULL AND artist_row.bio_description != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.city IS NOT NULL AND artist_row.city != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.country IS NOT NULL AND artist_row.country != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.styles_array IS NOT NULL AND array_length(artist_row.styles_array, 1) > 0 THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.session_price IS NOT NULL AND artist_row.session_price != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.years_experience IS NOT NULL AND artist_row.years_experience != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.instagram IS NOT NULL AND artist_row.instagram != '' THEN campos_llenos := campos_llenos + 1; END IF;
  IF artist_row.whatsapp_number IS NOT NULL AND artist_row.whatsapp_number != '' THEN campos_llenos := campos_llenos + 1; END IF;
  RETURN (campos_llenos * 100) / total_campos;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_artist_index()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.artist_index := calculate_artist_index(NEW);
  NEW.profile_completeness := calculate_profile_completeness(NEW);
  NEW.index_updated_at := NOW();
  RETURN NEW;
END;
$function$;

-- ================================================================
-- STEP 15: Recreate all 3 triggers
-- ================================================================
CREATE TRIGGER trigger_update_artist_index
  BEFORE INSERT OR UPDATE ON public.artists_db
  FOR EACH ROW EXECUTE FUNCTION update_artist_index();

CREATE TRIGGER trigger_sync_artist_to_auth
  AFTER INSERT OR UPDATE OF name, whatsapp_number
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artist_to_auth();

CREATE TRIGGER trigger_delete_auth_on_artist_delete
  AFTER DELETE ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_auth_on_artist_delete();

-- ================================================================
-- STEP 16: Reload PostgREST schema cache
-- ================================================================
NOTIFY pgrst, 'reload schema';

COMMIT;
