-- Per-user draft storage for the artist registration wizard.
-- The wizard previously kept all in-progress state in browser memory; if the user
-- closed the tab, lost connectivity, or hit a transient server error mid-flow they
-- silently lost their progress. This table persists the wizard's formState.data
-- as JSONB so the client can autosave on every field change / step transition and
-- restore the draft when the user comes back. The row is deleted after a
-- successful submitForm() upsert into artists_db.

BEGIN;

CREATE TABLE IF NOT EXISTS public.artist_registration_drafts (
    user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    draft_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_step TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE  public.artist_registration_drafts IS 'Wizard autosave for /register-artist. One row per user; deleted after successful submit.';
COMMENT ON COLUMN public.artist_registration_drafts.draft_data   IS 'Snapshot of client formState.data (all wizard fields).';
COMMENT ON COLUMN public.artist_registration_drafts.current_step IS 'Last step the user was on (number as text, or "summary").';

CREATE OR REPLACE FUNCTION public.set_artist_registration_drafts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_artist_registration_drafts_updated_at ON public.artist_registration_drafts;
CREATE TRIGGER trigger_artist_registration_drafts_updated_at
  BEFORE UPDATE ON public.artist_registration_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_artist_registration_drafts_updated_at();

ALTER TABLE public.artist_registration_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own registration draft" ON public.artist_registration_drafts;
CREATE POLICY "Users can read own registration draft"
  ON public.artist_registration_drafts
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own registration draft" ON public.artist_registration_drafts;
CREATE POLICY "Users can insert own registration draft"
  ON public.artist_registration_drafts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own registration draft" ON public.artist_registration_drafts;
CREATE POLICY "Users can update own registration draft"
  ON public.artist_registration_drafts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own registration draft" ON public.artist_registration_drafts;
CREATE POLICY "Users can delete own registration draft"
  ON public.artist_registration_drafts
  FOR DELETE
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
