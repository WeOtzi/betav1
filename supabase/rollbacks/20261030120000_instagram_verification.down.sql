-- Reversa de supabase/migrations/20261030120000_instagram_verification.sql
-- (validación de Instagram del artista).
-- 1. La RPC get_artist_public_profile_preferences vuelve al cuerpo original de
--    20260829103500 (sin instagram_validation).
-- 2. Se quita el guardián de instagram_verified_at / instagram_verified_handle.
-- 3. sync_artist_gallery_feed_items y su trigger vuelven al cuerpo y a la lista
--    de columnas originales de 20260329000000, y gallery_images se recalcula
--    con todas las fotos del feed (las importaciones pendientes vuelven a ser
--    públicas, como antes de la migración).
-- 4. Se borran las funciones de visibilidad, las columnas de artists_db y la
--    tabla artist_instagram_verifications (se pierde el historial de
--    validaciones y quién estaba validado: exportalo antes si hace falta).
-- Las claves "ig_legacy" que el backfill agregó a gallery_feed_items quedan en
-- su lugar: artist_gallery_feed_items_are_valid admite claves extra y sin esta
-- migración nadie las lee, así que no molestan (y si se vuelve a aplicar, el
-- backfill de la primera aplicación las respeta).
-- El orden importa: el trigger restaurado ya no menciona las columnas nuevas
-- antes de borrarlas.

begin;

-- ===================== 1. RPC pública (cuerpo de 20260829103500) =====================
create or replace function public.get_artist_public_profile_preferences(p_artist_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'privacy', jsonb_build_object(
      'show_city', coalesce((prefs.privacy ->> 'show_city')::boolean, true),
      'show_rating', coalesce((prefs.privacy ->> 'show_rating')::boolean, true),
      'show_socials', coalesce((prefs.privacy ->> 'show_socials')::boolean, true),
      'allow_search_indexing', coalesce((prefs.privacy ->> 'allow_search_indexing')::boolean, false)
    ),
    'profile', jsonb_build_object(
      'full_name', nullif(btrim(prefs.app_settings #>> '{profile,full_name}'), ''),
      'tiktok', nullif(btrim(prefs.app_settings #>> '{profile,tiktok}'), ''),
      'banner_url', nullif(btrim(prefs.app_settings #>> '{profile,banner_url}'), '')
    ),
    'availability', coalesce(prefs.app_settings -> 'availability', '{}'::jsonb)
  )
  from public.artists_db artist
  left join public.user_preferences prefs on prefs.user_id = artist.user_id
  where artist.user_id = p_artist_user_id
  limit 1;
$$;

revoke all on function public.get_artist_public_profile_preferences(uuid) from public;
grant execute on function public.get_artist_public_profile_preferences(uuid) to anon, authenticated;

comment on function public.get_artist_public_profile_preferences(uuid) is
  'Safe public projection for artist profile privacy, public profile extras and weekly availability.';

-- ===================== 2. guardián =====================
drop trigger if exists artists_db_protect_instagram_verification_fields on public.artists_db;
drop function if exists public.enforce_artist_instagram_verification_fields();

-- ===================== 3. sincronización original (20260329000000) =====================
CREATE OR REPLACE FUNCTION public.sync_artist_gallery_feed_items()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.gallery_images IS NULL OR jsonb_typeof(NEW.gallery_images) <> 'array' THEN
    NEW.gallery_images := '[]'::jsonb;
  END IF;

  IF NEW.gallery_feed_items IS NULL THEN
    NEW.gallery_feed_items := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(NEW.gallery_feed_items) = 'array' AND jsonb_array_length(NEW.gallery_feed_items) > 0 THEN
    NEW.gallery_images := public.artist_gallery_feed_items_to_legacy_images(NEW.gallery_feed_items);
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.gallery_images) = 'array' AND jsonb_array_length(NEW.gallery_images) > 0 THEN
    NEW.gallery_feed_items := public.artist_gallery_feed_items_from_legacy_images(NEW.gallery_images);
    NEW.gallery_images := public.artist_gallery_feed_items_to_legacy_images(NEW.gallery_feed_items);
  END IF;

  RETURN NEW;
END;
$function$;

-- En producción la función tenía search_path fijo desde
-- 20260610220000_fix_function_search_paths (ALTER FUNCTION ... SET search_path).
-- CREATE OR REPLACE sin SET lo borra: se restaura para volver al estado exacto
-- previo a la migración y no reabrir el aviso function_search_path_mutable.
ALTER FUNCTION public.sync_artist_gallery_feed_items() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trigger_sync_artist_gallery_feed_items ON public.artists_db;
CREATE TRIGGER trigger_sync_artist_gallery_feed_items
  BEFORE INSERT OR UPDATE OF gallery_images, gallery_feed_items
  ON public.artists_db
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_artist_gallery_feed_items();

-- gallery_images vuelve a llevar todas las fotos del feed (el trigger restaurado
-- calcula el mismo valor).
update public.artists_db
set gallery_images = public.artist_gallery_feed_items_to_legacy_images(gallery_feed_items)
where jsonb_typeof(gallery_feed_items) = 'array'
  and jsonb_array_length(gallery_feed_items) > 0
  and gallery_images is distinct from public.artist_gallery_feed_items_to_legacy_images(gallery_feed_items);

-- ===================== 4. funciones, columnas y tabla nuevas =====================
drop function if exists public.artist_gallery_item_is_public(jsonb, timestamptz, text);
drop function if exists public.artist_gallery_item_is_instagram(jsonb);

alter table public.artists_db
  drop column if exists instagram_verified_handle,
  drop column if exists instagram_verified_at;

drop table if exists public.artist_instagram_verifications;

notify pgrst, 'reload schema';

commit;
