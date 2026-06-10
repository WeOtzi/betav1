-- Reuse the existing public.app_settings table (created earlier in the
-- project; managed by public/shared/js/config-manager.js) as the storage
-- for the Apify API token used by the Instagram import feature.
--
-- Schema is owned by an earlier migration; we only INSERT the row here.
-- Columns:
--   setting_key   TEXT UNIQUE
--   setting_value TEXT
--   setting_type  TEXT CHECK IN ('text','html','json','number','boolean')
--   description   TEXT
--   is_public     BOOLEAN  -- false marks the value as a secret; the
--                          -- existing SELECT policy ("Allow public read for
--                          -- public settings") restricts it to is_public=true,
--                          -- so non-admin clients cannot read this row.
--
-- The server reads/writes this row using the service-role key (bypasses RLS)
-- via lib/app-settings.js, gated by verifyAdminCaller() at the API layer.

INSERT INTO public.app_settings (setting_key, setting_value, setting_type, description, is_public)
VALUES (
    'apify_token',
    NULL,
    'text',
    'Apify API token used by the Instagram import feature (lib/instagram-import.js). is_public=false so anon/authenticated cannot read it via RLS — server reads with service_role key.',
    false
)
ON CONFLICT (setting_key) DO NOTHING;
