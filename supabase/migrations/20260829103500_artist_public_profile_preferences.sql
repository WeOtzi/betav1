-- Proyección pública mínima de las preferencias del perfil del artista.
-- user_preferences continúa siendo privada por RLS: esta función solo expone
-- los campos que el propio centro de cuenta presenta como públicos.

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
