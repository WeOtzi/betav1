-- Workstation photos now belong only to sedes (studio_locations.workstation_photos,
-- added in 20260603010000). Drop the short-lived studios-level column added in
-- 20260603000000. Verified empty before dropping (0 rows had data).

BEGIN;

ALTER TABLE public.studios
  DROP COLUMN IF EXISTS workstation_photos;

NOTIFY pgrst, 'reload schema';

COMMIT;
