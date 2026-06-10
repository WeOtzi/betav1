-- artists_db: structured address columns for independent artists
--
-- Studio-affiliated artists pull location from the studio. Independent ones
-- need their own structured address so we can render them precisely on the
-- map and offer "Cómo llegar". Reuses the same column names as studios so a
-- single AddressPicker component can target either table.

BEGIN;

ALTER TABLE public.artists_db
  ADD COLUMN IF NOT EXISTS country_code       TEXT,
  ADD COLUMN IF NOT EXISTS state_province     TEXT,
  ADD COLUMN IF NOT EXISTS locality           TEXT,
  ADD COLUMN IF NOT EXISTS street             TEXT,
  ADD COLUMN IF NOT EXISTS street_number      TEXT,
  ADD COLUMN IF NOT EXISTS unit               TEXT,
  ADD COLUMN IF NOT EXISTS postal_code        TEXT,
  ADD COLUMN IF NOT EXISTS formatted_address  TEXT,
  ADD COLUMN IF NOT EXISTS google_place_id    TEXT;

NOTIFY pgrst, 'reload schema';

COMMIT;
