-- Fix: add id UUID as PK so Supabase Table Editor can identify rows correctly
-- Problem: user_id as PK caused Table Editor to fail row selection and delete operations
-- Solution: add id UUID column as PK, keep user_id as UNIQUE

-- 1. Drop FK constraints that depend on the old PK index
ALTER TABLE public.quotations_db DROP CONSTRAINT quotations_db_artist_id_fkey;
ALTER TABLE public.job_board_requests DROP CONSTRAINT job_board_requests_accepted_artist_id_fkey;
ALTER TABLE public.job_board_applications DROP CONSTRAINT job_board_applications_artist_id_fkey;

-- 2. Add id column with auto-generated UUID
ALTER TABLE public.artists_db ADD COLUMN id UUID DEFAULT gen_random_uuid() NOT NULL;

-- 3. Add UNIQUE constraint on user_id to maintain referential integrity
ALTER TABLE public.artists_db ADD CONSTRAINT artists_db_user_id_unique UNIQUE (user_id);

-- 4. Drop old PK on user_id
ALTER TABLE public.artists_db DROP CONSTRAINT "Tatuadores_pkey";

-- 5. Set id as new primary key
ALTER TABLE public.artists_db ADD CONSTRAINT artists_db_pkey PRIMARY KEY (id);

-- 6. Recreate FK constraints with their original delete rules
ALTER TABLE public.quotations_db
  ADD CONSTRAINT quotations_db_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES public.artists_db(user_id) ON DELETE SET NULL;

ALTER TABLE public.job_board_requests
  ADD CONSTRAINT job_board_requests_accepted_artist_id_fkey
  FOREIGN KEY (accepted_artist_id) REFERENCES public.artists_db(user_id) ON DELETE NO ACTION;

ALTER TABLE public.job_board_applications
  ADD CONSTRAINT job_board_applications_artist_id_fkey
  FOREIGN KEY (artist_id) REFERENCES public.artists_db(user_id) ON DELETE CASCADE;
