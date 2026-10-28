-- Reversa de supabase/migrations/20261028100000_acceso_registro_extras.sql
-- Quita los enlaces separados y los temas de novedades del registro de artistas.
-- `portafolio` y `subscribed_newsletter` no se tocan (siguen siendo la fuente
-- compatible del sitio principal y de la suscripción).

ALTER TABLE public.artists_db
  DROP CONSTRAINT IF EXISTS artists_db_newsletter_topics_known,
  DROP CONSTRAINT IF EXISTS artists_db_profile_links_is_object;

ALTER TABLE public.artists_db
  DROP COLUMN IF EXISTS newsletter_topics,
  DROP COLUMN IF EXISTS profile_links;
