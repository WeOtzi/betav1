-- Reversa de 20261115110000_perfil_username_integridad.sql: saca el trigger y
-- el índice del username y devuelve get_artist_public_profile_preferences a su
-- versión anterior (sin la clave `verified`). Los usernames ya normalizados a
-- minúsculas quedan como están.

begin;

drop trigger if exists trg_guard_artist_username on public.artists_db;
drop function if exists public.guard_artist_username();
drop function if exists public.wo_artist_username_is_valid(text);
drop index if exists public.artists_db_username_lower_finalized_uniq;

create or replace function public.get_artist_public_profile_preferences(p_artist_user_id uuid)
returns jsonb
language sql
stable security definer
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
    'availability', coalesce(prefs.app_settings -> 'availability', '{}'::jsonb),
    'instagram_validation', jsonb_build_object(
      'enforced', true,
      'verified', artist.instagram_verified_at is not null,
      'handle', nullif(btrim(artist.instagram_verified_handle), '')
    )
  )
  from public.artists_db artist
  left join public.user_preferences prefs on prefs.user_id = artist.user_id
  where artist.user_id = p_artist_user_id
  limit 1;
$$;

commit;
