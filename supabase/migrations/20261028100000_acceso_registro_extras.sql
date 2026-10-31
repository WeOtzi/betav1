-- ============================================================================
-- Figma final del flujo de artista (oct 2026) · área acceso · registro
-- ----------------------------------------------------------------------------
-- Grupo 04 "Tu presencia" separa los enlaces del artista (Sitio web, Behance,
-- Otro) y el grupo 06 "Novedades" elige 4 temas. Hasta ahora artists_db solo
-- guardaba un enlace (`portafolio`) y un boolean (`subscribed_newsletter`).
--
--   profile_links      jsonb  { "website": text|null, "behance": text|null, "other": text|null }
--   newsletter_topics  text[] subconjunto de {oportunidades, herramientas, avisos, recursos}
--
-- Aditiva e idempotente. artists_db ya tiene RLS habilitado: las políticas
-- existentes (el artista edita su fila; lectura pública del perfil) cubren las
-- columnas nuevas, no hace falta una política adicional.
-- `portafolio` y `subscribed_newsletter` se siguen escribiendo (compatibilidad).
-- Escritura desde el frontend: WeotziData.Registration.saveProfileExtras
-- (public/shared/js/data/registration-extras-repo.js).
-- Reversa: supabase/rollbacks/20261028100000_acceso_registro_extras.down.sql
-- ============================================================================

ALTER TABLE public.artists_db
  ADD COLUMN IF NOT EXISTS profile_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS newsletter_topics text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'artists_db_profile_links_is_object'
      AND conrelid = 'public.artists_db'::regclass
  ) THEN
    ALTER TABLE public.artists_db
      ADD CONSTRAINT artists_db_profile_links_is_object
      CHECK (jsonb_typeof(profile_links) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'artists_db_newsletter_topics_known'
      AND conrelid = 'public.artists_db'::regclass
  ) THEN
    ALTER TABLE public.artists_db
      ADD CONSTRAINT artists_db_newsletter_topics_known
      CHECK (newsletter_topics <@ ARRAY['oportunidades', 'herramientas', 'avisos', 'recursos']::text[]);
  END IF;
END $$;

-- Backfill: el sitio web principal ya guardado pasa a profile_links.website y
-- los suscriptos existentes quedan con los 4 temas (equivalente al boolean).
UPDATE public.artists_db
SET profile_links = jsonb_build_object('website', portafolio, 'behance', NULL, 'other', NULL)
WHERE profile_links = '{}'::jsonb
  AND portafolio IS NOT NULL
  AND portafolio <> ''
  AND portafolio !~* 'instagram\.com';

UPDATE public.artists_db
SET newsletter_topics = ARRAY['oportunidades', 'herramientas', 'avisos', 'recursos']::text[]
WHERE subscribed_newsletter IS TRUE
  AND cardinality(newsletter_topics) = 0;

COMMENT ON COLUMN public.artists_db.profile_links IS
  'Enlaces del artista del registro 04 (Figma final oct 2026): {website, behance, other}.';
COMMENT ON COLUMN public.artists_db.newsletter_topics IS
  'Temas de novedades elegidos en el registro 06: oportunidades, herramientas, avisos, recursos.';
